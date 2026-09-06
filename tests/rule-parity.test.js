'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../game/engine');
const {loadPage}=require('./helpers/page');

test('server and offline move rules agree for all built-in developer scenarios and dice',t=>{
  const page=loadPage();t.after(()=>page.close());
  const scenarios=page.window.eval('DEV_SCENARIOS.map(s=>({label:s.label,state:s.build()}))');
  const normalize=moves=>Array.from(moves,m=>JSON.stringify({pieceIds:Array.from(m.pieceIds),color:m.color,kind:m.kind,steps:m.steps,isExit:!!m.isExit})).sort();
  for(const scenario of scenarios){
    for(let die=1;die<=6;die++){
      page.window.fixtureState=JSON.parse(JSON.stringify(scenario.state));
      page.window.eval('state=fixtureState');
      const local=page.state();
      const server=Object.assign(engine.freshState({activeColors:Array.from(local.activeColors),teamMode:local.teamMode}),{
        pieces:Array.from(local.pieces,p=>({id:p.id,color:p.color,relativePosition:p.relPos})),turnIndex:local.turnIdx,
        frozenKillerId:local.frozenKillerId,phase:'moving',dice:die,pendingRolls:[die]
      });
      assert.deepEqual(normalize(engine.legalMoves(server,die)),normalize(page.window.computeMovable(die)),scenario.label+' / die '+die);
    }
  }
  assert.equal(page.errors.length,0,page.errors.map(e=>e.message).join('\n'));
  t.diagnostic(scenarios.length+' scenarios × 6 dice compared');
});
