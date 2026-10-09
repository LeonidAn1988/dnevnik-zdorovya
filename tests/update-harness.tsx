import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/App'
import { useUpdate } from '../src/ui/useUpdate'
import { UpdateBlock, UpdateNudge } from '../src/ui/Update'
import { DEFAULT_SETTINGS, saveSettings } from '../src/db/store'
import { installPlatform } from '../src/platform/ports'
import { webPlatform } from '../src/platform/web'

const w=window as any
w.downloads=[];w.installs=[];w.openedSettings=0
installPlatform({...webPlatform,update:{...webPlatform.update,canSelfUpdate:()=>true,canInstall:async()=>true,requestInstall:async()=>{w.openedSettings++;return true},download:async(url:string)=>{w.downloads.push(url);return '/test/update.apk'},install:async(path:string)=>{w.installs.push(path)}}})
const root=createRoot(document.getElementById('root')!)
function UpdateHarness(){w.update=useUpdate('0.43.0');return <div className="app"><UpdateNudge состояние={w.update}/><UpdateBlock состояние={w.update}/></div>}
w.start=()=>root.render(<UpdateHarness/>);w.unmount=()=>root.render(null)
w.startApp=async(scale='normal',overview=true,interfaceStyle='classic')=>{
 await saveSettings({...DEFAULT_SETTINGS,onboarded:true,guideOffered:true,people:[{id:'p',name:'Тест'}],activePerson:'p',textScale:scale,interfaceStyle,sections:{...DEFAULT_SETTINGS.sections,overview,intake:overview}})
 root.render(<App/>)
}
