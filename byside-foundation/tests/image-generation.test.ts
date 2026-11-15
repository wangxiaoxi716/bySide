import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCharacter, parseReferenceImage } from '../server/src/image-generation';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
test('accepts valid png and rejects forged image data',()=>{assert.equal(parseReferenceImage('data:image/png;base64,'+png.toString('base64')).mime,'image/png');assert.throws(()=>parseReferenceImage('data:image/png;base64,YWJj'));});
test('sends reference image to provider edit API and validates output',async()=>{
 let sent:any;
 const result=await generateCharacter('data:image/png;base64,'+png.toString('base64'),{key:'test',fetch:async(url:any,init:any)=>{sent={url,init};return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}),{status:200,headers:{'content-type':'application/json'}})}});
 assert.equal(sent.url,'https://api.openai-next.com/v1/images/edits');assert.equal(sent.init.body.get('model'),'gpt-image-2');assert.ok(sent.init.body.get('image') instanceof Blob);assert.deepEqual(result,png);
});
test('rejects invalid provider output',async()=>{await assert.rejects(()=>generateCharacter('data:image/png;base64,'+png.toString('base64'),{key:'test',fetch:async()=>new Response(JSON.stringify({data:[{b64_json:'YWJj'}]}),{status:200})}));});
