const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const mod={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../lib/readiness.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
const {summarizeReadiness,playerReadiness}=mod.exports;
const screen={id:'s',status:'active'};
const campaign={screen_ids:['s'],creative_ids:['c']};
test('empty inventory explains absent campaigns and missing creatives',()=>{
 assert.equal(summarizeReadiness(screen,[],[],0).code,'no_campaign');
 assert.equal(summarizeReadiness(screen,[{screen_ids:['s'],creative_ids:[]}],[],0).code,'no_creative');
 assert.equal(summarizeReadiness({...screen,status:'paused'},[],[],0).code,'screen_not_active');
});
test('valid playable delivery stays ready despite nonblocking budget warning',()=>{
 const r=summarizeReadiness(screen,[campaign],[{eligible:true,reason:'eligible',warnings:['budget_exhausted_manual_action']}],1);
 assert.equal(r.ready,true);assert.deepEqual(r.warnings,['budget_exhausted_manual_action']);
});
test('empty playlist reports an actual blocking decision',()=>{
 const r=summarizeReadiness(screen,[campaign],[{eligible:false,reason:'outside_operating_hours'}],0);
 assert.equal(r.ready,false);assert.equal(r.code,'outside_operating_hours');
});
test('unattended player receives only public allowlisted readiness',()=>{
 assert.deepEqual(playerReadiness({code:'eligible',message:'private amount',warnings:['budget_80_percent'],budget:900}),{ready:true,code:'eligible',message:'Ready to play'});
 assert.equal(playerReadiness({code:'budget_80_percent'}).code,'unavailable');
 assert.equal(playerReadiness({code:'private_value'}).code,'unavailable');
 assert.equal(playerReadiness(null),undefined);
});
