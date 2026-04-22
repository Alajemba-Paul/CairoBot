import { Position } from './extended';

export type Side = 'LONG' | 'SHORT';

export interface OrderDetails {
  market: string;
  side: Side;
  leverage: number;
  margin: number;
  tpPrice?: number;
  slPrice?: number;
}

export enum WizardStep {
  IDLE,
  AWAIT_MARKET,
  AWAIT_LEVERAGE,
  AWAIT_CUSTOM_LEVERAGE,
  AWAIT_MARGIN,
  AWAIT_CUSTOM_MARGIN,
  AWAIT_TP,
  AWAIT_SL,
  AWAIT_CONFIRM,
  AWAIT_CLOSE_CONFIRM,
  AWAIT_TP_CONFIRM,
  AWAIT_SL_CONFIRM
}

export interface WizardState {
  step: WizardStep;
  order: Partial<OrderDetails>;
  walletAddress?: string;
  closeMarket?: string;
  closePosition?: Position;
  messageId?: number;
}

export interface CloseConfirmState {
  market: string;
  position: Position;
}
