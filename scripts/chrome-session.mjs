import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function chromeSession() {
  const directory=await mkdtemp(path.join(tmpdir(),'guitar-trainer-'));
  const chrome=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',[
    '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${directory}`,
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--mute-audio',
    '--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows','--window-size=1280,1100','about:blank'
  ],{windowsHide:true,stdio:'ignore'});
  let socket;
  try {
    let port;for(let i=0;i<100;i++){try{port=(await readFile(path.join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(100);}}
    assert.ok(port,'Chrome did not start');const tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let id=0;const pending=new Map(),errors=[],requests=[];
    socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,m=>m.error?reject(m.error):resolve(m.result));socket.send(JSON.stringify({id:request,method,params}));});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const until=async(expression,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){const result=await evaluate(expression);if(result)return result;await pause(100);}throw new Error(`Timed out: ${expression}\n${JSON.stringify(await evaluate("({body:document.body.innerText,records:window.__trainer?.records,errors:window.__trainer?.errors})"))}`);};
    await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
    return {send,evaluate,until,errors,requests,directory,screenshot:async file=>writeFile(file,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64')),close:async()=>{await Promise.race([send('Browser.close'),pause(1000)]);socket.close();chrome.kill();}};
  }catch(error){socket?.close();chrome.kill();throw error;}
}
