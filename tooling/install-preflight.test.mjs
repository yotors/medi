import assert from 'node:assert/strict';import {test} from 'node:test';import {validateInstall} from './install-preflight.mjs';
test('invalid origins, aliases, missing secrets and forged evidence never yield ready',()=>{
 for(const origin of ['http://example.test','https://user:pass@example.test','https://example.test/path','https://localhost']){
 const result=validateInstall({origin,images:{api:'latest'},evidence:{collectorHealthy:true},decisions:{operator:true}});assert.equal(result.ready,false);assert.equal(result.runtimeVerified,false);assert.ok(result.failed.includes('https_origin'));assert.ok(result.failed.includes('immutable_images'));}
});
