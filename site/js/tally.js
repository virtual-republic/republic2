// The browser counts with the same arithmetic as the register.
//
// core/tally.js is copied into js/core/ at build time and imported here
// unchanged. There is one implementation of counting, not two, so a page and
// the register cannot disagree — art-08/§4/¶5.
export { tally, instantRunoff, ballotMessage, receiptOf, closesAt } from './core/tally.js';
