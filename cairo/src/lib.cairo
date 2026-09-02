//! MarginRouter — the single STRK20 privacy_invoke helper for CairoBot.
//!
//! Pool transfers USDC in, then calls `privacy_invoke`. We measure the ERC-20
//! balance the pool already sent, route it, and return `OpenNoteDeposit`
//! leftovers so the pool can credit notes. One invoke per tx. End token
//! balance is 0. We never transfer to the user.
//!
//! Signature matches the official helper pattern (op first, amount in
//! calldata so the wallet/pool know the spend, note_id is an open-note
//! placeholder):
//!   privacy_invoke(op, token, amount, note_id, venue, user)
//!
//! op = 0 FundMargin
//!   venue != 0  → approve + deposit(user, spend); leftover → OpenNoteDeposit
//!   venue == 0  → approve full balance back to the pool (valid first pool tx)
//! op = 1 SweepPnl
//!   approve full helper balance to the pool as one open note
//!
//! OpenNoteDeposit matches starter-kit positional Serde: (note_id, token, amount: u128).

use core::num::traits::Zero;
use starknet::ContractAddress;

#[derive(Copy, Drop, Serde)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IVenue<TContractState> {
    fn deposit(ref self: TContractState, user: ContractAddress, amount: u256);
}

/// One entry point. The pool deserializes calldata into these parameters.
/// Do not add a second `privacy_invoke` — Starknet selectors are name-only.
#[starknet::interface]
pub trait IMarginRouter<TContractState> {
    fn privacy_invoke(
        ref self: TContractState,
        op: u8,
        token: ContractAddress,
        amount: u256,
        note_id: felt252,
        venue: ContractAddress,
        user: ContractAddress,
    ) -> Span<OpenNoteDeposit>;
}

const OP_FUND_MARGIN: u8 = 0;
const OP_SWEEP_PNL: u8 = 1;

#[starknet::contract]
mod MarginRouter {
    use core::array::ArrayTrait;
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        IERC20Dispatcher, IERC20DispatcherTrait, IVenueDispatcher, IVenueDispatcherTrait,
        OpenNoteDeposit, OP_FUND_MARGIN, OP_SWEEP_PNL,
    };

    #[storage]
    struct Storage {
        pool: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(!pool.is_zero(), 'pool required');
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl MarginRouterImpl of super::IMarginRouter<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            op: u8,
            token: ContractAddress,
            amount: u256,
            note_id: felt252,
            venue: ContractAddress,
            user: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            let caller = get_caller_address();
            let pool = self.pool.read();
            assert(caller == pool, 'caller must be pool');
            assert(!token.is_zero(), 'token required');
            assert(op == OP_FUND_MARGIN || op == OP_SWEEP_PNL, 'unknown op');

            let this = get_contract_address();
            let erc20 = IERC20Dispatcher { contract_address: token };
            let balance: u256 = erc20.balance_of(this);
            assert(balance.high == 0, 'amount exceeds u128');
            assert(amount.high == 0, 'amount exceeds u128');

            // Spend is the requested amount when set, otherwise everything the
            // pool already sent. Always measured — never trust the external
            // protocol's return.
            let spend: u256 = if amount.low == 0 {
                balance
            } else {
                assert(balance >= amount, 'underfunded');
                amount
            };
            assert(spend.low != 0, 'zero spend');

            if op == OP_SWEEP_PNL {
                erc20.approve(pool, balance);
                return array![
                    OpenNoteDeposit { note_id, token, amount: balance.low },
                ]
                    .span();
            }

            // op == FundMargin
            if venue.is_zero() {
                erc20.approve(pool, balance);
                return array![OpenNoteDeposit { note_id, token, amount: balance.low }].span();
            }

            assert(!user.is_zero(), 'user required');
            erc20.approve(venue, spend);
            IVenueDispatcher { contract_address: venue }.deposit(user, spend);
            let leftover: u256 = erc20.balance_of(this);
            assert(leftover.high == 0, 'leftover exceeds u128');
            if leftover.low == 0 {
                return array![].span();
            }
            erc20.approve(pool, leftover);
            array![OpenNoteDeposit { note_id, token, amount: leftover.low }].span()
        }
    }
}
