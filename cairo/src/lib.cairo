//! MarginRouter — the single STRK20 privacy_invoke helper for CairoBot.
//!
//! Pool transfers USDC in, then calls `privacy_invoke`. We measure the ERC-20
//! balance the pool already sent, route it, and return `OpenNoteDeposit`
//! leftovers so the pool can credit notes. One invoke per tx. End token
//! balance is 0. We never transfer to the user.
//!
//! op = 0 FundMargin
//!   venue != 0  → approve + deposit(user, amount); leftover → OpenNoteDeposit
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

/// Spec signature — token, pool, note, op, venue, user.
#[starknet::interface]
pub trait IMarginRouter<TContractState> {
    fn privacy_invoke(
        ref self: TContractState,
        token: ContractAddress,
        pool_address: ContractAddress,
        note_id: felt252,
        op: u8,
        venue: ContractAddress,
        user: ContractAddress,
    ) -> Span<OpenNoteDeposit>;
}

/// Official STRK20 helper ABI the pool's INVOKE_SELECTOR deserializes.
#[starknet::interface]
pub trait IPrivacyHelper<TContractState> {
    fn privacy_invoke(ref self: TContractState, deposits: Span<OpenNoteDeposit>) -> Span<OpenNoteDeposit>;
    fn arm(ref self: TContractState, op: u8, venue: ContractAddress, user: ContractAddress);
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
        armed_op: u8,
        armed_venue: ContractAddress,
        armed_user: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(!pool.is_zero(), 'pool required');
        self.pool.write(pool);
        self.armed_op.write(OP_FUND_MARGIN);
    }

    #[abi(embed_v0)]
    impl MarginRouterImpl of super::IMarginRouter<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            token: ContractAddress,
            pool_address: ContractAddress,
            note_id: felt252,
            op: u8,
            venue: ContractAddress,
            user: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            self._privacy_invoke(token, pool_address, note_id, op, venue, user)
        }
    }

    #[abi(embed_v0)]
    impl PrivacyHelperImpl of super::IPrivacyHelper<ContractState> {
        fn arm(ref self: ContractState, op: u8, venue: ContractAddress, user: ContractAddress) {
            assert(op == OP_FUND_MARGIN || op == OP_SWEEP_PNL, 'unknown op');
            self.armed_op.write(op);
            self.armed_venue.write(venue);
            self.armed_user.write(user);
        }

        fn privacy_invoke(
            ref self: ContractState, deposits: Span<OpenNoteDeposit>,
        ) -> Span<OpenNoteDeposit> {
            assert(deposits.len() > 0, 'deposits required');
            let first = *deposits.at(0);
            self
                ._privacy_invoke(
                    first.token,
                    get_caller_address(),
                    first.note_id,
                    self.armed_op.read(),
                    self.armed_venue.read(),
                    self.armed_user.read(),
                )
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _privacy_invoke(
            ref self: ContractState,
            token: ContractAddress,
            pool_address: ContractAddress,
            note_id: felt252,
            op: u8,
            venue: ContractAddress,
            user: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            let caller = get_caller_address();
            let pool = self.pool.read();
            assert(caller == pool, 'caller must be pool');
            assert(pool_address == pool, 'wrong pool');
            assert(!token.is_zero(), 'token required');

            let this = get_contract_address();
            let erc20 = IERC20Dispatcher { contract_address: token };
            let balance: u256 = erc20.balance_of(this);
            assert(balance.high == 0, 'amount exceeds u128');
            let amount: u128 = balance.low;

            if op == OP_FUND_MARGIN {
                if !venue.is_zero() {
                    assert(!user.is_zero(), 'user required');
                    erc20.approve(venue, balance);
                    IVenueDispatcher { contract_address: venue }.deposit(user, balance);
                    let leftover: u256 = erc20.balance_of(this);
                    assert(leftover.high == 0, 'leftover exceeds u128');
                    if leftover.low == 0 {
                        return array![].span();
                    }
                    erc20.approve(pool_address, leftover);
                    return array![
                        OpenNoteDeposit { note_id, token, amount: leftover.low },
                    ]
                        .span();
                }
                erc20.approve(pool_address, balance);
                return array![OpenNoteDeposit { note_id, token, amount }].span();
            }

            if op == OP_SWEEP_PNL {
                erc20.approve(pool_address, balance);
                return array![OpenNoteDeposit { note_id, token, amount }].span();
            }

            assert(false, 'unknown op');
            array![].span()
        }
    }
}
