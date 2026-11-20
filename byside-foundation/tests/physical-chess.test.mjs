import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPlacementGate, findDarkPieces, projectedCell } from '../original-ui/physical-chess.mjs';
import { createVoiceGameController } from '../original-ui/voice-games.js';

test('maps projected intersections and rejects ambiguous gaps between cells',()=>{
  const chess={kind:'chess',rect:{left:100,right:380,top:50,bottom:330}};
  assert.equal(projectedCell({x:240,y:190},chess),112);
  assert.equal(projectedCell({x:249,y:190},chess),null);
  const cells=Array.from({length:9},(_,i)=>({left:i%3*90,right:i%3*90+80,top:Math.floor(i/3)*90,bottom:Math.floor(i/3)*90+80}));
  assert.equal(projectedCell({x:130,y:130},{kind:'tic-tac-toe',cells}),4);
  assert.equal(projectedCell({x:84,y:130},{kind:'tic-tac-toe',cells}),null);
});

test('requires a clear board and one stable placement and does not repeat a held piece',()=>{
  const gate=createPlacementGate();
  for(let now=0;now<=600;now+=100)assert.equal(gate.update([0],now),null);
  for(let now=700;now<=1000;now+=100)assert.equal(gate.update([],now),null);
  for(let now=1100;now<=1600;now+=100)assert.equal(gate.update([0],now),null);
  assert.equal(gate.update([0],1700),0);
  for(let now=1800;now<=2500;now+=100)assert.equal(gate.update([0],now),null);
  gate.reset();
  for(let now=0;now<=300;now+=100)gate.update([],now);
  gate.update([0],400);
  assert.equal(gate.update([0],1100),null);
  assert.equal(gate.update([0,1],1200),null);
});

test('a round dark piece is found while thin projected grid lines are ignored',async()=>{
  const require=createRequire(import.meta.url);
  const {cv}=await new Promise(resolve=>require('../original-ui/vendor/opencv.js').then(cv=>resolve({cv})));
  const width=480,height=300,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const light=(x-200)**2+(y-180)**2<=100?32:x%22===0||y%22===0?65:180;
    data.set([light,light,light,255],(y*width+x)*4);
  }
  const pieces=findDarkPieces(cv,{width,height,data});
  assert.equal(pieces.length,1);
  assert.ok(Math.hypot(pieces[0].x-200,pieces[0].y-180)<2);
});

test('first placement needs no empty frame and triggers the companion turn in both voice games',()=>{
  for(const [kind,index,row,column] of [['chess',112,8,8],['tic-tac-toe',4,2,2]]){
    const voice=createVoiceGameController();
    assert.equal(voice.handleTool({name:'open_tabletop_game',arguments:JSON.stringify({game:kind})}).ok,true);
    const gate=createPlacementGate();
    gate.reset({armed:true});
    for(let now=0;now<=500;now+=100)assert.equal(gate.update([index],now),null);
    assert.equal(gate.update([index],600),index);
    const result=voice.handleTool({name:'operate_tabletop_game',arguments:JSON.stringify({action:'place',row,column})});
    assert.ok(result.ok&&result.assistantMove);
    assert.equal(voice.snapshot().game.moves.length,2);
    assert.equal(gate.update([index],700),null);
  }
});

test('physical moves use a legal vision suggestion and fall back when it is occupied',()=>{
  const open=()=>{
    const game=createVoiceGameController();
    game.handleTool({name:'open_tabletop_game',arguments:'{"game":"tic-tac-toe"}'});
    return game;
  };
  const game=open(), revision=game.revision();
  const result=game.placePhysical(2,2,{index:0,feedback:'看到你落子了。'});
  assert.equal(game.snapshot().game.board[0],2);
  assert.match(result.message,/看到你落子了/);
  assert.notEqual(game.revision(),revision);
  const fallback=open();
  assert.ok(fallback.placePhysical(2,2,{index:4}).assistantMove);
  assert.equal(fallback.snapshot().game.board[4],1);
});
