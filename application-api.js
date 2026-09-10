(function(){
  'use strict';
  const API_URL = 'https://grani-miniapp2.4000680.workers.dev/api/applications';
  const LOCAL_KEY = 'grani_applications_v1';

  function initData(){
    return window.Telegram && window.Telegram.WebApp ? (window.Telegram.WebApp.initData || '') : '';
  }

  function localList(){
    try{
      const items = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
      return Array.isArray(items) ? items.slice(0, 10) : [];
    }catch(_){ return []; }
  }

  function localSave(items){
    try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(items.slice(0, 10))); }catch(_){}
    return items.slice(0, 10);
  }

  async function request(method, body){
    const data = initData();
    if(!data) return null;
    const response = await fetch(API_URL, {
      method,
      headers:{
        'content-type':'application/json',
        'x-telegram-init-data':data
      },
      body:body ? JSON.stringify(body) : undefined,
      cache:'no-store'
    });
    if(!response.ok) throw new Error('Не удалось открыть архив заявок');
    const result = await response.json();
    return result.items || [];
  }

  async function list(){
    const remote = await request('GET');
    return remote === null ? localList() : remote;
  }

  async function add(item){
    const remote = await request('POST', item);
    if(remote !== null) return remote;
    const saved = Object.assign({
      id:(window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      createdAt:new Date().toISOString()
    }, item);
    return localSave([saved].concat(localList().filter(old => old.id !== saved.id)));
  }

  async function clear(){
    const remote = await request('DELETE');
    if(remote !== null) return remote;
    return localSave([]);
  }

  window.GraniApplications = {list, add, clear};
})();
