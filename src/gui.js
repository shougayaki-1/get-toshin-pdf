import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseOptions } from './common.js';
import { createGuiServer } from './gui-server.js';

const options=parseOptions(process.argv.slice(2));
await mkdir(options.dataDir,{recursive:true,mode:0o700});
const context=await chromium.launchPersistentContext(path.join(options.dataDir,'browser-profile'), {headless:false,acceptDownloads:true,viewport:{width:1280,height:900}});
const {server,url}=await createGuiServer({context,dir:options.dataDir});
const pos=context.pages().find(p=>p.url().startsWith('https://pos.toshin.com/')) || context.pages()[0] || await context.newPage();
if(!pos.url().startsWith('https://pos.toshin.com/')) await pos.goto('https://pos.toshin.com/',{waitUntil:'domcontentloaded'});
const gui=await context.newPage(); await gui.goto(url); await gui.bringToFront();
console.log('GUIとPOSのタブを開きました。終了するにはブラウザを閉じるか Ctrl+C を押してください。');
let closing=false;
async function close(){if(closing)return;closing=true;server.close();await context.close().catch(()=>{});}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());context.once('close',()=>{closing=true;server.close();});
