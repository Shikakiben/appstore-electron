#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { fetch, AbortController } = require('undici');
const os = require('os');

const userData = path.join(os.homedir(), '.config', 'am-appstore');
const cacheDir = path.join(userData, 'icons-cache');
const indexPath = path.join(cacheDir, 'index.json');

function usage(){
  console.log('Usage: download-icons.js [--limit=N] [--concurrency=M]');
}

let limit = 500;
let concurrency = 6;
let doAll = false;
let assumeYes = false;
for(const a of process.argv.slice(2)){
  if (a === '--all') doAll = true;
  else if (a === '--yes') assumeYes = true;
  else if (a.startsWith('--limit=')) limit = Number(a.split('=')[1]) || limit;
  else if (a.startsWith('--concurrency=')) concurrency = Number(a.split('=')[1]) || concurrency;
}

if (!fs.existsSync(cacheDir)){
  console.error('Cache dir not found:', cacheDir);
  process.exit(1);
}
if (!fs.existsSync(indexPath)){
  console.error('index.json not found in cache dir:', indexPath);
  process.exit(1);
}

let index;
try{
  index = JSON.parse(fs.readFileSync(indexPath,'utf8')||'{}');
}catch(e){ console.error('failed to parse index.json', e.message); process.exit(1); }

const keys = Object.keys(index);
// allNames will be computed inside run() so we can prompt synchronously there if needed

function download(name){
  return new Promise((resolve) => {
    const dest = path.join(cacheDir, name);
    if (fs.existsSync(dest)) return resolve({ name, ok:true, reason:'exists' });
    const url = `https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/${name}`;
    (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => { try { controller.abort(); } catch(_){} }, 15000);
      let res;
      try {
        res = await fetch(url, { method: 'GET', signal: controller.signal });
      } catch (err) {
        clearTimeout(timeout);
        const msg = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || String(err);
        return resolve({ name, ok:false, reason: msg });
      }
      clearTimeout(timeout);
      if (res.status !== 200) { try { await res.body?.cancel?.(); } catch(_){} return resolve({ name, ok:false, reason:`status ${res.status}` }); }
      const tmp = dest + '.tmp';
      try {
        const ab = await res.arrayBuffer();
        const buf = Buffer.from(ab);
        if (buf.length < 200) { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch(_){} return resolve({ name, ok:false, reason:'too small' }); }
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, dest);
        return resolve({ name, ok:true });
      } catch (e) {
        try{ if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch(_){}
        return resolve({ name, ok:false, reason: e && e.message });
      }
    })();
  });
}

async function run(){
  let allNames;
  if (doAll) {
    console.log(`--all requested: ${keys.length} icons available in index.json`);
    if (!assumeYes) {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise(res => rl.question(`Download all ${keys.length} icons? (y/N) `, a => { rl.close(); res(a); }));
      if (!/^y(es)?$/i.test(answer)) { console.log('Aborted by user'); process.exit(0); }
    }
    limit = keys.length;
  }
  allNames = keys.slice(0, limit);
  console.log(`Will check ${allNames.length} icons (limit ${limit}), concurrency ${concurrency}`);
  const queue = allNames.slice();
  let running = 0;
  let results = [];
  function next(){
    if (!queue.length && running === 0) return Promise.resolve();
    while (running < concurrency && queue.length){
      const name = queue.shift();
      running++;
      download(name).then((r)=>{ results.push(r); running--; process.stdout.write(`Downloaded: ${r.name} -> ${r.ok ? 'OK' : 'FAIL('+r.reason+')'}\n`); next(); }).catch((e)=>{ results.push({name,ok:false,reason:e.message}); running--; next(); });
    }
  }
  await next();
  // wait for all to finish
  while (running>0) await new Promise(r=>setTimeout(r,200));
  const ok = results.filter(r=>r.ok).length;
  const fail = results.length - ok;
  console.log(`Done: ${results.length} processed, ok=${ok}, fail=${fail}`);
  process.exit(0);
}

run().catch(e=>{ console.error(e); process.exit(1); });
