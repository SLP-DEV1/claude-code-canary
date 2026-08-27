import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type SafeMcpFixtureKind =
  | 'read'
  | 'write'
  | 'timeout'
  | 'malformed-schema'
  | 'dynamic-tools'
  | 'disconnect'
  | 'pagination'
  | 'annotations';

export interface SafeMcpFixture {
  kind: SafeMcpFixtureKind;
  root: string;
  stateDir: string;
  scriptPath: string;
  command: string;
  args: string[];
  cleanup: () => Promise<void>;
}

function source(kind: SafeMcpFixtureKind, stateDir: string): string {
  const encodedKind = JSON.stringify(kind);
  const encodedState = JSON.stringify(stateDir);
  return String.raw`'use strict';
const fs = require('node:fs');
const path = require('node:path');
const KIND = ${encodedKind};
const STATE = ${encodedState};
let listCount = 0;
function send(value){ process.stdout.write(JSON.stringify(value)+'\n'); }
function isObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
function tools(){
  if (KIND === 'malformed-schema') return [{name:'broken',description:'intentionally malformed schema',inputSchema:'not-an-object'}];
  const base = [{name:'read_state',description:'Read isolated fixture state',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}}];
  if (KIND === 'write') base.push({name:'write_state',description:'Write only inside the isolated fixture directory',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false}});
  if (KIND === 'timeout') base.push({name:'slow',description:'Intentionally never returns before the caller timeout',inputSchema:{type:'object',properties:{},additionalProperties:false}});
  if (KIND === 'dynamic-tools' && listCount > 0) base.push({name:'dynamic',description:'Appears after the first tools/list call',inputSchema:{type:'object',properties:{},additionalProperties:false}});
  if (KIND === 'disconnect') base.push({name:'disconnect',description:'Closes the isolated stdio transport so clients can exercise reconnect handling',inputSchema:{type:'object',properties:{},additionalProperties:false}});
  if (KIND === 'annotations') {
    base.push({name:'safe_write',description:'Isolated non-destructive write',inputSchema:{type:'object',properties:{value:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}});
    base.push({name:'declared_mutation',description:'Mutation annotation test; still restricted to fixture state',inputSchema:{type:'object',properties:{value:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}});
  }
  listCount++;
  return base;
}
function handle(msg){
  if(!isObj(msg)||msg.jsonrpc!=='2.0') return;
  const id=msg.id;
  if(msg.method==='initialize'&&id!==undefined){
    const caps={tools:{listChanged:KIND==='dynamic-tools'}};
    if(KIND==='pagination') caps.resources={};
    send({jsonrpc:'2.0',id,result:{protocolVersion:(msg.params&&msg.params.protocolVersion)||'2025-06-18',capabilities:caps,serverInfo:{name:'claude-canary-safe-fixture',version:'1.0.0'}}}); return;
  }
  if(msg.method==='ping'&&id!==undefined){ send({jsonrpc:'2.0',id,result:{}}); return; }
  if(msg.method==='tools/list'&&id!==undefined){ send({jsonrpc:'2.0',id,result:{tools:tools()}}); if(KIND==='dynamic-tools'&&listCount===1) setTimeout(()=>send({jsonrpc:'2.0',method:'notifications/tools/list_changed'}),5); return; }
  if(msg.method==='resources/list'&&id!==undefined&&KIND==='pagination'){
    const cursor=isObj(msg.params)&&typeof msg.params.cursor==='string'?msg.params.cursor:'';
    if(!cursor){ send({jsonrpc:'2.0',id,result:{resources:[{uri:'fixture://page/1',name:'page-1'}],nextCursor:'page-2'}}); }
    else if(cursor==='page-2'){ send({jsonrpc:'2.0',id,result:{resources:[{uri:'fixture://page/2',name:'page-2'}]}}); }
    else send({jsonrpc:'2.0',id,error:{code:-32602,message:'Unknown cursor'}});
    return;
  }
  if(msg.method==='resources/read'&&id!==undefined&&KIND==='pagination'){
    const uri=isObj(msg.params)&&typeof msg.params.uri==='string'?msg.params.uri:'';
    send({jsonrpc:'2.0',id,result:{contents:[{uri,text:'isolated '+uri}]}}); return;
  }
  if(msg.method==='tools/call'&&id!==undefined){
    const params=isObj(msg.params)?msg.params:{}; const args=isObj(params.arguments)?params.arguments:{};
    if(params.name==='read_state'){ let value=''; try{value=fs.readFileSync(path.join(STATE,'value.txt'),'utf8')}catch{} send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:value}],isError:false}}); return; }
    if(params.name==='write_state'&&KIND==='write'){ fs.writeFileSync(path.join(STATE,'value.txt'),String(args.value||''),'utf8'); send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'ok'}],isError:false}}); return; }
    if(params.name==='safe_write'&&KIND==='annotations'){ fs.writeFileSync(path.join(STATE,'safe.txt'),String(args.value||''),'utf8'); send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'ok'}],isError:false}}); return; }
    if(params.name==='declared_mutation'&&KIND==='annotations'){ fs.writeFileSync(path.join(STATE,'declared-mutation.txt'),String(args.value||''),'utf8'); send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'isolated mutation'}],isError:false}}); return; }
    if(params.name==='slow'&&KIND==='timeout'){ return; }
    if(params.name==='dynamic'&&KIND==='dynamic-tools'){ send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'dynamic'}],isError:false}}); return; }
    if(params.name==='disconnect'&&KIND==='disconnect'){ process.exit(0); return; }
    send({jsonrpc:'2.0',id,error:{code:-32601,message:'Unknown fixture tool'}}); return;
  }
  if(id!==undefined) send({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
}
let buffer=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',chunk=>{ buffer+=chunk; for(;;){ const nl=buffer.indexOf('\n'); if(nl<0) break; const line=buffer.slice(0,nl).trim(); buffer=buffer.slice(nl+1); if(!line) continue; try{handle(JSON.parse(line))}catch(e){process.stderr.write(String(e)+'\n')} } });
`;
}

export async function createSafeMcpFixture(kind: SafeMcpFixtureKind, options: { root?: string } = {}): Promise<SafeMcpFixture> {
  const root = options.root ? path.resolve(options.root) : await mkdtemp(path.join(tmpdir(), 'claude-canary-mcp-'));
  const stateDir = path.join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  const scriptPath = path.join(root, 'server.cjs');
  await writeFile(scriptPath, source(kind, stateDir), 'utf8');
  return {
    kind,
    root,
    stateDir,
    scriptPath,
    command: process.execPath,
    args: [scriptPath],
    cleanup: async () => { if (!options.root) await rm(root, { recursive: true, force: true }); },
  };
}
