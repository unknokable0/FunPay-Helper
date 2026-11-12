(() => {
  'use strict';
  document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
  const main = document.getElementById('main'), toast = document.getElementById('toast');
  const version = chrome.runtime.getManifest().version;
  const repo = 'https://github.com/unknokable0/FunPay-Helper';
  document.getElementById('version').textContent = 'v' + version;
  let state = {templates:FPH_DEFAULT_TEMPLATES, settings:{...FPH_DEFAULT_SETTINGS}, update:null};
  let view = 'home', editing = false, busy = false, search = '', toastTimer;
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
    if (editing && !confirm('В редакторе могут быть несохранённые изменения. Выйти?')) return;
    editing=false; view=next; search=''; render(); main.focus();
  }
  function heading(label,title,description) {return el('header',{class:'section-header'},el('div',{class:'eyebrow'},label),el('h1',{},title),el('p',{},description));}
  function shortcut(symbol,title,desc,target) {return el('button',{type:'button',class:'shortcut',onClick:()=>go(target)},el('span',{class:'shortcut-icon'},icon(symbol)),el('span',{},el('strong',{},title),el('small',{},desc)),icon('arrow','arrow'));}
  function home() {
    const enabled=!!state.settings.templatesEnabled;
    return [heading('ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО','Всё под рукой','Быстрые ответы и настройки — прямо на FunPay.'),
      el('section',{class:'surface hero'},el('div',{},el('div',{class:'hero-tag'},icon('chat'),'ШАБЛОНЫ СООБЩЕНИЙ'),el('h2',{},'Меньше рутины. Больше общения.'),el('p',{},'Сохраняйте готовые ответы и вставляйте их в чат одним нажатием. Отправка всегда остаётся за вами.'),button('Открыть шаблоны',()=>go('templates'),'primary','arrow')),
        el('div',{class:'hero-stat'},el('div',{class:'stat-title'},'Ваши шаблоны'),el('div',{class:'stat-number'},String(state.templates.length)),el('div',{class:'stat-desc'},'сохранено'),el('div',{class:'status'+(enabled?'':' off')},el('span',{class:'dot'}),enabled?'Кнопки включены':'Кнопки выключены'))),
      el('section',{class:'section'},el('div',{class:'section-title'},el('h2',{},'Быстрый доступ'),el('span',{class:'caption'},'Всё самое нужное')),el('div',{class:'shortcuts'},shortcut('chat','Шаблоны','Создать или изменить ответ','templates'),shortcut('settings','Настройки','Кнопки в чате и обновления','settings'))),
      el('div',{class:'footnote'},icon('shield'),'Ваши шаблоны хранятся локально в этом браузере.')];
  }
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
    const query=el('input',{type:'search',class:'control',placeholder:'Поиск шаблонов',value:search,'aria-label':'Поиск шаблонов'});
    const holder=el('div',{},templateList());
    query.addEventListener('input',()=>{search=query.value; holder.replaceChildren(templateList());});
    return [heading('СООБЩЕНИЯ','Шаблоны','Готовые ответы для общения с покупателями.'),el('div',{class:'toolbar'},el('h2',{},'Ваши шаблоны · '+state.templates.length),el('div',{class:'toolbar-actions'},el('div',{class:'search'},icon('search'),query),button('Восстановить стандартные',restore),button('Создать',()=>edit(null),'primary','plus'))),holder,el('div',{class:'hint'},'Текст вставляется в чат без автоматической отправки.')];
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
    main.replaceChildren(heading('СООБЩЕНИЯ',index===null?'Новый шаблон':'Редактирование','Название будет видно на кнопке в чате.'),
      el('div',{class:'surface form'},el('label',{class:'field',for:'template-name'},'Название',name),el('label',{class:'field',for:'template-category'},'Категория · необязательно',category),el('label',{class:'field',for:'template-text'},'Текст сообщения',text),el('p',{class:'form-help'},'Сообщение не будет отправлено автоматически.'),error,el('div',{class:'form-actions'},save,button('Отмена',()=>go('templates')))));
    name.focus();
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
  function settings() {
    const on=!!state.settings.templatesEnabled, update=state.update, newer=update?.latest && fphCmpVersion(update.latest,version)>0;
    let title='Проверка обновлений', detail='Проверка каждые 6 часов и при запуске браузера.';
    if (newer) {title='Доступна версия '+update.latest; detail=update.error?'Последняя проверка не удалась; показан предыдущий результат.':'Скачайте ZIP и обновите файлы в прежней папке расширения.';}
    else if(update?.error) {title='Не удалось проверить обновления'; detail='Проверьте соединение и попробуйте снова.';}
    else if(update?.latest) {title='Обновлений не найдено'; detail='Проверено: '+new Date(update.checkedAt).toLocaleString('ru-RU');}
    const checkButton=button(busy?'Проверяем…':'Проверить',check);
    if(busy) checkButton.disabled=true;
    const updateActions=el('div',{class:'update-actions'},checkButton,newer?el('a',{class:'btn primary',href:repo+'/archive/refs/heads/main.zip',target:'_blank',rel:'noopener noreferrer'},'Скачать ZIP'):null);
    return [heading('ПРИЛОЖЕНИЕ','Настройки','Управление функциями и обновлениями.'),
      el('section',{class:'setting-section'},el('h2',{},'Шаблоны'),el('div',{class:'surface setting'},el('div',{},el('strong',{},'Быстрые ответы в чате'),el('p',{},'Показывать кнопки шаблонов над полем сообщения.')),el('button',{type:'button',class:'switch',role:'switch','aria-label':'Быстрые ответы в чате','aria-checked':String(on),onClick:toggle}))),
      el('section',{class:'setting-section'},el('h2',{},'Обновления'),el('div',{class:'surface setting update'},el('div',{},el('strong',{},title),el('p',{},detail)),updateActions),el('p',{class:'update-note'},'Установленные вручную расширения Chrome не обновляются автоматически. После замены файлов нажмите «Обновить» на странице расширений; не удаляйте расширение.')),
      el('section',{class:'setting-section'},el('h2',{},'О расширении'),el('div',{class:'surface setting'},el('div',{},el('strong',{},'FunPay Helper · v'+version),el('p',{},'Шаблоны и настройки хранятся локально.')),el('a',{class:'btn',href:repo,target:'_blank',rel:'noopener noreferrer'},'GitHub ↗')))];
  }
  function planned(title, description) {
    return [heading('В РАЗРАБОТКЕ',title,'Этот раздел пока недоступен.'),el('div',{class:'surface planned'},el('span',{class:'planned-icon'},icon('clock')),el('h2',{},'Скоро здесь появится больше'),el('p',{},description))];
  }
  function render() {
    document.querySelectorAll('[data-view]').forEach(item=>{const active=item.dataset.view===view;item.classList.toggle('active',active); if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
    main.replaceChildren(...(view==='templates'?templates():view==='settings'?settings():view==='lots'?planned('Лоты','Управление лотами ещё не реализовано.'):view==='actions'?planned('Быстрые действия','Дополнительные инструменты для заказов и чатов ещё не реализованы.'):view==='stats'?planned('Статистика','Проверенных данных о продажах пока нет.'):home()));
  }
  document.querySelectorAll('[data-view]').forEach(item=>item.addEventListener('click',()=>go(item.dataset.view)));
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && ['templates','settings','update'].some(k=>changes[k]) && !editing) load().then(()=>{if(!editing)render();}).catch(()=>notify('Не удалось прочитать данные.'));});
  load().then(render).catch(()=>{render();notify('Не удалось прочитать данные.');});
  let sizeTimer;
  function reportSize(){clearTimeout(sizeTimer);sizeTimer=setTimeout(()=>{const h=Math.ceil(document.querySelector('.app-shell').getBoundingClientRect().height);parent.postMessage({type:'fph-size',height:h},'https://funpay.com');},40);}
  new ResizeObserver(reportSize).observe(document.querySelector('.app-shell')); reportSize();
})();
