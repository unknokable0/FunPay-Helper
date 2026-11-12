(() => {
  'use strict';
  document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
  const main = document.getElementById('main'), toast = document.getElementById('toast');
  const version = chrome.runtime.getManifest().version;
  const repo = 'https://github.com/unknokable0/FunPay-Helper';
  document.getElementById('version').textContent = 'v' + version;
  let state = {templates:FPH_DEFAULT_TEMPLATES, settings:{...FPH_DEFAULT_SETTINGS}, update:null};
  let view = 'templates', editing = false, editDirty = () => false, busy = false, search = '', toastTimer;
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'value') node.value = v;
      else if (k === 'disabled') node.disabled = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) node.setAttribute(k,v);
    }
    for (const child of children.flat()) if (child != null) node.append(child);
    return node;
  };
  function icon(name, cls='') {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('aria-hidden','true'); if(cls) svg.setAttribute('class',cls);
    const use=document.createElementNS('http://www.w3.org/2000/svg','use'); use.setAttribute('href','#i-'+name); svg.append(use); return svg;
  }
  function button(text, action, cls='', iconName='') {return el('button',{type:'button',class:'btn '+cls,onClick:action},iconName?icon(iconName):null,text);}
  function notify(text) {toast.textContent=text; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.classList.remove('show'),3500);}
  async function load() {const data=await chrome.storage.local.get(['templates','settings','update']); state={templates:Array.isArray(data.templates)?data.templates:FPH_DEFAULT_TEMPLATES,settings:{...FPH_DEFAULT_SETTINGS,...(data.settings||{})},update:data.update||null};}
  function go(next) {
    if (editing && editDirty() && !confirm('У вас есть несохранённые изменения. Выйти без сохранения?')) return;
    editing=false; view=next; search=''; main.classList.remove('view-appear'); render(); requestAnimationFrame(()=>main.classList.add('view-appear'));
  }
  function heading(label,title,description) {return el('header',{class:'section-header'},el('div',{class:'eyebrow'},label),el('h1',{},title),el('p',{},description));}
  function templateList() {
    const list=el('div',{class:'surface list'});
    const needle=search.trim().toLocaleLowerCase('ru');
    const entries=state.templates.map((item,index)=>({item,index})).filter(({item})=>[item?.name,item?.text,item?.category].some(x=>String(x||'').toLocaleLowerCase('ru').includes(needle)));
    if (!entries.length) list.append(el('div',{class:'empty'},state.templates.length?'Ничего не найдено. Попробуйте другой запрос.':'Здесь пока пусто. Создайте свой первый шаблон.'));
    for (const {item:t,index} of entries) {
      list.append(el('article',{class:'template'},el('div',{class:'template-body'},el('div',{class:'template-name'},String(t?.name||'')),t?.category?el('div',{class:'template-category'},String(t.category)):null,el('div',{class:'template-text'},String(t?.text||''))),el('div',{class:'actions'},button('Изменить',()=>edit(index)),button('Удалить',()=>remove(index),'danger'))));
    }
    return list;
  }
  function templates() {
    const query=el('input',{type:'search',class:'control',placeholder:'Поиск по шаблонам',value:search,'aria-label':'Поиск шаблонов'});
    const holder=el('div',{},templateList());
    query.addEventListener('input',()=>{search=query.value; holder.replaceChildren(templateList());});
    return [heading('БЫСТРЫЕ ОТВЕТЫ','Шаблоны сообщений','Сохраняйте ответы, чтобы быстро вставлять их в переписку на FunPay.'),
      el('div',{class:'guide'},el('span',{class:'guide-icon'},icon('chat')),el('div',{},el('strong',{},'Как это работает'),el('p',{},'Создайте шаблон, затем выберите его кнопкой «Шаблоны» рядом с полем чата. Проверьте текст и отправьте его сами.'))),
      el('div',{class:'toolbar'},el('h2',{},'Ваши шаблоны',el('span',{class:'count-badge'},String(state.templates.length))),el('div',{class:'toolbar-actions'},el('div',{class:'search'},icon('search'),query),button('Создать шаблон',()=>edit(null),'primary','plus'))),
      holder,el('div',{class:'list-footer'},el('span',{},'Шаблоны хранятся в этом браузере.'),button('Восстановить стандартные',restore,'subtle-action'))];
  }
  async function restore() {
    if (!confirm('Заменить все текущие шаблоны стандартными? Это действие нельзя отменить.')) return;
    try {
      const data=await chrome.storage.local.get('templates'), current=Array.isArray(data.templates)?data.templates:FPH_DEFAULT_TEMPLATES;
      if (JSON.stringify(current)!==JSON.stringify(state.templates)) {await load(); render(); notify('Список изменился. Повторите действие.'); return;}
      await chrome.storage.local.set({templates:FPH_DEFAULT_TEMPLATES}); await load(); render(); notify('Стандартные шаблоны восстановлены');
    } catch (_) {notify('Не удалось восстановить шаблоны.');}
  }
  async function remove(index) {
    const target=state.templates[index];
    if (!confirm('Удалить шаблон «'+(target?.name||'')+'»?')) return;
    try {
      const data=await chrome.storage.local.get('templates'), current=Array.isArray(data.templates)?data.templates:FPH_DEFAULT_TEMPLATES;
      if (JSON.stringify(current)!==JSON.stringify(state.templates)) {await load(); render(); notify('Список изменился. Повторите действие.'); return;}
      await chrome.storage.local.set({templates:current.filter((_,i)=>i!==index)}); await load(); render(); notify('Шаблон удалён');
    } catch (_) {notify('Не удалось удалить шаблон.');}
  }
  function edit(index) {
    editing=true;
    const original=index===null?{}:(state.templates[index]||{}), baseline=JSON.stringify(state.templates);
    const name=el('input',{class:'control',id:'template-name',maxlength:'80',value:original.name||'',autocomplete:'off'});
    const category=el('input',{class:'control',id:'template-category',maxlength:'80',value:original.category||'',autocomplete:'off'});
    const text=el('textarea',{class:'control',id:'template-text'}); text.value=original.text||'';
    const error=el('div',{class:'error',role:'alert'});
    const initial=JSON.stringify([name.value,category.value,text.value]);
    editDirty=()=>JSON.stringify([name.value,category.value,text.value])!==initial;
    const save=button('Сохранить',async()=>{
      const n=name.value.trim(), t=text.value.trim(), c=category.value.trim();
      if (!n||!t) {error.textContent='Укажите название и текст сообщения.'; return;}
      save.disabled=true;
      try {
        const data=await chrome.storage.local.get('templates'), current=Array.isArray(data.templates)?data.templates:FPH_DEFAULT_TEMPLATES;
        if(JSON.stringify(current)!==baseline) {error.textContent='Шаблоны изменились в другом окне. Скопируйте текст и откройте редактор заново.'; return;}
        const item={...original,name:n,text:t}; if(c) item.category=c; else delete item.category;
        const next=current.slice(); if(index===null) next.push(item); else next[index]=item;
        await chrome.storage.local.set({templates:next}); editing=false; await load(); render(); notify('Шаблон сохранён');
      } catch (_) {error.textContent='Не удалось сохранить шаблон. Попробуйте снова.';}
      finally {save.disabled=false;}
    },'primary');
    main.replaceChildren(heading('СООБЩЕНИЯ',index===null?'Новый шаблон':'Редактирование','Название будет видно в списке шаблонов в чате.'),
      el('div',{class:'surface form'},el('label',{class:'field',for:'template-name'},'Название',name),el('label',{class:'field',for:'template-category'},'Категория · необязательно',category),el('label',{class:'field',for:'template-text'},'Текст сообщения',text),el('p',{class:'form-help'},'Сообщение не будет отправлено автоматически.'),error,el('div',{class:'form-actions'},save,button('Отмена',()=>go('templates')))));
  }
  async function toggle() {
    try {const data=await chrome.storage.local.get('settings'); const current={...FPH_DEFAULT_SETTINGS,...(data.settings||{})}; await chrome.storage.local.set({settings:{...current,templatesEnabled:!current.templatesEnabled}}); await load(); render();}
    catch (_) {notify('Не удалось сохранить настройку.');}
  }
  async function check() {
    busy=true; render();
    try {const result=await chrome.runtime.sendMessage({type:'check-update'}); if(!result) throw Error('no response'); await load();} catch (_) {notify('Не удалось проверить обновления.');}
    finally {busy=false; if(view==='settings'&&!editing) render();}
  }
  async function exportBackup() {
    try {
      const data=await chrome.storage.local.get(['templates','settings']);
      const backup={format:'funpay-helper-backup',formatVersion:1,templates:Array.isArray(data.templates)?data.templates:FPH_DEFAULT_TEMPLATES,settings:{...FPH_DEFAULT_SETTINGS,...(data.settings||{})}};
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob);
      const link=document.createElement('a'); link.href=url; link.download='funpay-helper-backup.json'; document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
      notify('Резервная копия сохранена в загрузки');
    } catch (_) {notify('Не удалось создать резервную копию.');}
  }
  async function importBackup(event) {
    const input=event.target, file=input.files?.[0]; input.value=''; if(!file) return;
    try {
      if(file.size>8*1024*1024) throw Error('Файл слишком большой (максимум 8 МБ).');
      let backup; try {backup=JSON.parse(await file.text());} catch (_) {throw Error('Не удалось прочитать JSON-файл.');}
      if(!backup || backup.format!=='funpay-helper-backup' || backup.formatVersion!==1 || !Array.isArray(backup.templates) || !backup.settings || typeof backup.settings!=='object' || Array.isArray(backup.settings) || (backup.settings.templatesEnabled!==undefined && typeof backup.settings.templatesEnabled!=='boolean') || !backup.templates.every(t=>t && typeof t==='object' && !Array.isArray(t) && typeof t.name==='string' && t.name.trim() && typeof t.text==='string' && t.text.trim() && (t.category===undefined || typeof t.category==='string'))) throw Error('Это не подходящая резервная копия FP Helper.');
      const before=await chrome.storage.local.get(['templates','settings']);
      if(!confirm('Восстановить шаблоны ('+backup.templates.length+') и настройки из файла? Текущие шаблоны и настройки будут заменены.')) return;
      const now=await chrome.storage.local.get(['templates','settings']);
      if(JSON.stringify(before)!==JSON.stringify(now)) throw Error('Данные изменились. Повторите восстановление.');
      await chrome.storage.local.set({templates:backup.templates,settings:backup.settings}); await load(); render(); notify('Шаблоны и настройки восстановлены');
    } catch (e) {notify(e?.message || 'Не удалось восстановить копию.');}
  }
  function settings() {
    const on=!!state.settings.templatesEnabled, update=state.update, newer=update?.latest && fphCmpVersion(update.latest,version)>0;
    let title='Проверка обновлений', detail='Проверка выполняется каждые 6 часов и при запуске браузера.';
    if (newer) {title='Доступна версия '+update.latest; detail=update.error?'Последняя проверка не удалась; показан предыдущий результат.':'Для ручной установки скачайте архив и замените файлы в прежней папке.';}
    else if(update?.error) {title='Не удалось проверить обновления'; detail='Проверьте соединение и попробуйте снова.';}
    else if(update?.latest) {title='Обновлений не найдено'; const date=new Date(update.checkedAt); detail=Number.isNaN(date.getTime())?'Установлена актуальная версия.':'Последняя проверка: '+date.toLocaleString('ru-RU');}
    const checkButton=button(busy?'Проверяем…':'Проверить',check); if(busy) checkButton.disabled=true;
    const updateActions=el('div',{class:'update-actions'},checkButton,newer?el('a',{class:'btn primary',href:repo+'/archive/refs/heads/main.zip',target:'_blank',rel:'noopener noreferrer'},'Скачать ZIP'):null);
    const file=el('input',{type:'file',accept:'.json,application/json',class:'file-input','aria-label':'Выбрать резервную копию',onChange:importBackup});
    const upload=button('Восстановить из файла',()=>file.click());
    const switcher=el('button',{type:'button',class:'switch',role:'switch','aria-label':'Быстрые ответы в чате','aria-checked':String(on),onClick:toggle});
    const settingHeading=(symbol,title,description)=>el('div',{class:'setting-heading'},el('span',{class:'setting-icon'},icon(symbol)),el('div',{},el('h2',{},title),el('p',{},description)));
    return [heading('ПРИЛОЖЕНИЕ','Настройки','Настройте работу в чате и сохраните свои данные.'),
      el('section',{class:'surface settings-card'},settingHeading('chat','Быстрые ответы','Управление шаблонами в переписке'),el('div',{class:'setting-row'},el('div',{class:'setting-copy'},el('strong',{},'Кнопка «Шаблоны» в чате'),el('p',{},'Показывать кнопку рядом с полем сообщения. Вы сами выбираете и отправляете ответ.')),el('div',{class:'switch-control'},el('span',{},on?'Включено':'Выключено'),switcher))),
      el('section',{class:'surface settings-card'},settingHeading('shield','Резервная копия','Перенос и сохранение данных'),el('div',{class:'setting-row backup-row'},el('div',{class:'setting-copy'},el('strong',{},'Шаблоны и настройки'),el('p',{},'Скачайте копию перед переустановкой или переходом в другой браузер. Файл может содержать личные тексты.')),el('div',{class:'settings-actions'},button('Скачать копию',exportBackup),upload,file)),el('p',{class:'settings-note'},'При восстановлении текущие шаблоны и настройки будут заменены.')),
      el('section',{class:'surface settings-card'},settingHeading('clock','Обновления','Версия расширения и проверка'),el('div',{class:'setting-row'},el('div',{class:'setting-copy'},el('strong',{},title),el('p',{},detail)),updateActions),el('p',{class:'settings-note'},'Установленное вручную расширение необходимо обновлять самостоятельно. При обновлении не удаляйте его.')),
      el('section',{class:'surface settings-card about-card'},el('div',{class:'setting-copy'},el('strong',{},'FunPay Helper · v'+version),el('p',{},'Шаблоны и настройки хранятся локально в этом браузере.')),el('a',{class:'btn',href:repo,target:'_blank',rel:'noopener noreferrer'},'Открыть GitHub ↗'))];
  }
  function render() {
    document.querySelectorAll('[data-view]').forEach(item=>{const active=item.dataset.view===view;item.classList.toggle('active',active); if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
    main.replaceChildren(...(view==='settings'?settings():templates()));
  }
  document.querySelectorAll('[data-view]').forEach(item=>item.addEventListener('click',()=>go(item.dataset.view)));
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && (changes.templates || changes.settings || (changes.update && view==='settings')) && !editing) load().then(()=>{if(!editing)render();}).catch(()=>notify('Не удалось прочитать данные.'));});
  load().then(render).catch(()=>{render();notify('Не удалось прочитать данные.');});
  let sizeTimer;
  function reportSize(){clearTimeout(sizeTimer);sizeTimer=setTimeout(()=>{const h=Math.ceil(document.querySelector('.app-shell').getBoundingClientRect().height);parent.postMessage({type:'fph-size',height:h},'https://funpay.com');},40);}
  new ResizeObserver(reportSize).observe(document.querySelector('.app-shell')); reportSize();
})();
