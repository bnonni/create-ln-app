// A WebLN provider for development (https://www.webln.guide). A node of the network is the wallet.
// Each call goes to the API server, and the API server sends it to the node.
// A wallet extension, for example Alby, sets window.webln. That provider has the same calls.
// To use the wallet of the user, call window.webln.enable(), then use window.webln in place of nodeProvider(name).
import { createInvoice, getNodes, payInvoice } from './api';
import type { GetInfoResponse, RequestInvoiceArgs, WebLNProvider } from '@webbtc/webln-types';

// The amount in sats and the memo of a makeInvoice call. WebLN amounts are in sats.
// If the call has no amount, a wallet asks the user. This provider has no user interface, so it uses defaultAmount.
const invoiceArgs = (args: string | number | RequestInvoiceArgs) =>
  typeof args === 'object'
    ? { amount: Number(args.amount ?? args.defaultAmount), memo: args.defaultMemo }
    : { amount: Number(args), memo: undefined };

// A provider for the node `name`. As with a wallet, the other calls fail until enable succeeds.
export const nodeProvider = (name: string): WebLNProvider => {
  let enabled = false;
  const checkEnabled = () => {
    if (!enabled) throw new Error('Call webln.enable() before the other WebLN calls.');
  };

  return {
    async enable() {
      enabled = true;
    },

    async getInfo(): Promise<GetInfoResponse> {
      checkEnabled();
      const node = (await getNodes()).find((n) => n.name === name);
      if (!node) throw new Error(`The node ${name} does not exist.`);
      return {
        node: { alias: node.alias, pubkey: node.pubkey },
        version: 'create-ln-app',
        supports: ['lightning'],
        methods: ['getInfo', 'makeInvoice', 'sendPayment'],
      };
    },

    async makeInvoice(args) {
      checkEnabled();
      const { amount, memo } = invoiceArgs(args);
      if (!Number.isInteger(amount) || amount < 1) throw new Error('makeInvoice needs an amount of 1 sat or more.');
      const invoice = await createInvoice(name, amount, memo);
      return { paymentRequest: invoice.paymentRequest };
    },

    async sendPayment(paymentRequest) {
      checkEnabled();
      const payment = await payInvoice(name, paymentRequest);
      return { preimage: payment.preimage };
    },
  };
};
