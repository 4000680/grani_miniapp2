(function(){
  'use strict';
  const API_ROOT='https://grani-miniapp2.4000680.workers.dev/api';
  function initData(){return window.Telegram?.WebApp?.initData||'';}
  async function request(path,method='GET',body){
    const data=initData();
    if(!data)throw new Error('Откройте приложение через Telegram.');
    const response=await fetch(API_ROOT+path,{method,headers:{'content-type':'application/json','x-telegram-init-data':data},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    let result={};try{result=await response.json()}catch(_){}
    if(!response.ok)throw new Error(result.error||'Не удалось связаться с ботом.');
    return result;
  }
  window.GraniAPI={
    async listCalculations(){const result=await request('/applications');return Array.isArray(result.items)?result.items:[]},
    async getProfile(){const result=await request('/profile');return result.profile||{}},
    async launchAction(action){return request('/actions','POST',{action})},
    async sendCalculation(id){return request('/calculations/'+encodeURIComponent(id)+'/send','POST',{})}
  };
})();
