'use strict';
// A known original basket event, used as an approved business-date attribution
// anchor. This is NOT an asserted exact cash collection time.
const ANCHOR='2026-11-20T16:13:36.286Z';
const ORIGINAL_FIRST_HOLD_ID='fcf89f83-9e1f-4319-a028-df72a0967c38';
class AccountingDate extends Date {
 constructor(...args){super(...(args.length?args:[ANCHOR]));}
 static now(){return Date.parse(ANCHOR);}
}
const PRINT_EXPIRES_AT=new Date(Date.parse(ANCHOR)-53+24*3600000).toISOString();
const PRINT_BUDGET_MS=65000;
module.exports={AccountingDate,ANCHOR,ORIGINAL_FIRST_HOLD_ID,PRINT_EXPIRES_AT,PRINT_BUDGET_MS};
