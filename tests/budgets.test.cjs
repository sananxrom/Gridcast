const test=require('node:test'), assert=require('node:assert/strict');
const {ensureBudget,reserveBudget,budgetReceipt,budgetCommitted,validateBudgetEdit}=require('./load-lib.cjs')('budgets');
const now=Date.parse('2026-10-01T00:00:00Z');
function setup(budget=1){const c={id:'c',org_id:'origin',committed_budget:budget,accrued_spend:0,screen_ids:['a','b']};return {c,db:{campaigns:[c],device_assignments:[],settlement_buckets:[]}};}
const assignment=(id='a',extra={})=>({id,device_id:'device',campaign_id:'c',rate_type:'per_play',rate_value:.1,duration_s:10,issued_at:new Date(now).toISOString(),valid_until:new Date(now+3600000).toISOString(),accept_until:new Date(now+72*3600000).toISOString(),...extra});
test('reservation arithmetic uses paise and preserves unpaid allowance through offline acceptance',()=>{
 const {c,db}=setup(),a=assignment();assert.equal(reserveBudget(db,c,a,100,now),5);assert.equal(budgetCommitted(db.campaign_budgets[0],now),50);
 const b=assignment('b');assert.equal(reserveBudget(db,c,b,100,now+2*3600000),2);
 assert.equal(budgetCommitted(db.campaign_budgets[0],now+2*3600000),70);
 assert.equal(reserveBudget(db,c,assignment('c'),100,now+73*3600000),5);
});
test('receipts spend held money once per authorized rendered use and retain exact finite cap',()=>{
 const {c,db}=setup(.1),a=assignment();assert.equal(reserveBudget(db,c,a,100,now),1);
 assert.equal(budgetReceipt(db,c,a,true,true,now),true);assert.equal(budgetReceipt(db,c,a,true,true,now),false);
 assert.equal(db.campaign_budgets[0].spent_paise,10);assert.equal(reserveBudget(db,c,assignment('b'),100,now),0);
});
test('rejected attempts do not release money; accepted nonbillable attempts safely release their reservation',()=>{
 const {c,db}=setup(.1),a=assignment();reserveBudget(db,c,a,1,now);
 budgetReceipt(db,c,a,false,false,now);assert.equal(budgetCommitted(db.campaign_budgets[0],now),10);
 budgetReceipt(db,c,a,true,false,now);assert.equal(budgetCommitted(db.campaign_budgets[0],now),0);
 assert.equal(db.campaign_budgets[0].spent_paise,0);
});
test('legacy assignments reserve conservative full exposure without deleting evidence',()=>{
 const {c,db}=setup(100);c.accrued_spend=1;db.settlement_buckets.push({campaign_id:'c',gross_paise:123});
 db.device_assignments.push(assignment('old'));const ledger=ensureBudget(db,c,now);
 assert.equal(ledger.spent_paise,223);assert.equal(ledger.reservations[0].remaining_plays,361);
 assert.throws(()=>validateBudgetEdit(db,{...c,committed_budget:1},now),/outstanding screen allowances/);
 validateBudgetEdit(db,c,now);assert.equal(db.device_assignments[0].id,'old');
});
test('zero-price and flat campaigns have finite allowances but no monetary spend; missing budget positive-price fails closed',()=>{
 const {c,db}=setup(0);const free=assignment('free',{rate_value:0});assert.equal(reserveBudget(db,c,free,77,now),77);
 budgetReceipt(db,c,free,true,true,now);assert.equal(db.campaign_budgets[0].spent_paise,0);
 const flat=assignment('flat',{rate_type:'flat',rate_value:1000});assert.equal(reserveBudget(db,c,flat,12,now),12);
 delete c.committed_budget;assert.equal(reserveBudget(db,c,assignment('paid'),12,now),0);
});
