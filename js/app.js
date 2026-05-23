import { firebaseConfig } from './firebase.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getDatabase, ref, onValue, set, update, remove } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

const ADMIN_EMAIL='airwav7@gmail.com';
const DEFAULT_CATEGORIES=['회원 / 리워즈','포인트 / 쿠폰 / 바우처','결제 / PG / Eximbay','주문 / 커머스 / e-Shop','POS / PMS / Opera','API / 배치 / 연동','기타 / 하드코딩','나의 기억','장애 로그','회의록 / 아젠다','FAQ / 용어사전'];
const PAGE_SIZE=20;
const state={user:null,docs:[],categories:['전체',...DEFAULT_CATEGORIES],selected:null,category:'전체',query:'',page:1,unsubscribe:null,catUnsub:null,bundledDocs:[],bundledMap:{},appVersion:null};
const $=id=>document.getElementById(id);
const appEl=$('app'), toastEl=$('toast'), listView=$('listView'), detailView=$('detailView'), formView=$('formView');
const firebaseApp=initializeApp(firebaseConfig), auth=getAuth(firebaseApp), db=getDatabase(firebaseApp);

function toast(msg){toastEl.textContent=msg;toastEl.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>toastEl.classList.remove('show'),2600)}
function esc(v=''){return String(v).replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function fmt(v){if(!v)return'-';const d=new Date(v);return Number.isNaN(d.getTime())?String(v).slice(0,10):d.toISOString().slice(0,10)}
function today(){return new Date().toISOString().slice(0,10)}
function newId(t){return (t||'doc').toLowerCase().replace(/[^a-z0-9가-힣]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)+'-'+Date.now().toString(36)}

async function loadManifest(){
  try{
    const r=await fetch('wiki_docs/manifest.json',{cache:'no-store'});
    if(!r.ok) return;
    const m=await r.json();
    state.bundledDocs=Array.isArray(m.docs)?m.docs:[];
    state.bundledMap=Object.fromEntries(state.bundledDocs.map(d=>[d.id,d]));
  }catch(e){console.warn('manifest load failed',e)}
}
async function loadVersion(){
  try{
    const r=await fetch('version.json',{cache:'no-store'});
    if(!r.ok) return;
    state.appVersion=await r.json();
    renderVersionInfo();
  }catch(e){console.warn('version load failed',e)}
}
function versionLabel(v=state.appVersion){
  if(!v?.version) return '—';
  return v.release?`${v.release} (${v.version})`:v.version;
}
function renderVersionInfo(){
  const v=state.appVersion;
  const label=versionLabel(v);
  const hero=$('heroVersion'), side=$('sidebarVersion'), stat=$('statVersion');
  if(hero) hero.textContent=label;
  if(side) side.textContent=label;
  if(stat) stat.textContent=v?.version||'—';
  if(hero&&v?.updatedAt) hero.title=`배포일 ${v.updatedAt}`;
  if(side&&v?.updatedAt) side.title=`배포일 ${v.updatedAt}`;
  if(stat&&v?.updatedAt) stat.title=`배포일 ${v.updatedAt}`;
  document.title=`eseo Wiki ${v?.version||''} | Parnas AI Operations Wiki`.replace(/\s+/g,' ').trim();
}
function isAdmin(){return (state.user?.email||'').toLowerCase()===ADMIN_EMAIL.toLowerCase()}
function syncAdminUI(){document.querySelectorAll('[data-admin-only]').forEach(el=>el.classList.toggle('hidden',!isAdmin()))}
function editableCategories(){return state.categories.filter(c=>c!=='전체')}
function categoryOptions(){return editableCategories().map(c=>`<option>${esc(c)}</option>`).join('')}
function normalizeCategoryList(val){
  if(Array.isArray(val))return val.filter(c=>c&&c!=='전체');
  if(val&&typeof val==='object')return Object.keys(val).sort((a,b)=>Number(a)-Number(b)).map(k=>val[k]).filter(c=>c&&c!=='전체');
  return null;
}
function applyCategories(list){
  const normalized=normalizeCategoryList(list);
  const next=normalized?.length?normalized:[...DEFAULT_CATEGORIES];
  state.categories=['전체',...next];
  if(!state.categories.includes(state.category))state.category='전체';
  renderCats();
  if($('categoryModal')&&!$('categoryModal').classList.contains('hidden'))renderCategoryModalList();
}
function subscribeCategories(){
  if(state.catUnsub)state.catUnsub();
  state.catUnsub=onValue(ref(db,'wikiMeta/categories'),async snap=>{
    const normalized=normalizeCategoryList(snap.val());
    if(!normalized?.length&&isAdmin()){await persistCategories(DEFAULT_CATEGORIES);return}
    applyCategories(snap.val());
  },e=>toast(e.message));
}
function openCategoryModal(){
  if(!isAdmin())return;
  renderCategoryModalList();
  $('categoryModal').classList.remove('hidden');
  $('categoryModal').setAttribute('aria-hidden','false');
  $('newCategoryInput').value='';
}
function closeCategoryModal(){
  $('categoryModal').classList.add('hidden');
  $('categoryModal').setAttribute('aria-hidden','true');
}
function moveCategoryRow(row,dir){
  if(!row)return;
  const sibling=dir<0?row.previousElementSibling:row.nextElementSibling;
  if(!sibling?.classList?.contains('cat-manage-row'))return;
  const body=$('categoryModalBody');
  if(dir<0)body.insertBefore(row,sibling);
  else body.insertBefore(sibling,row);
}
function renderCategoryModalList(){
  $('categoryModalBody').innerHTML=editableCategories().map(c=>`<div class="cat-manage-row"><div class="cat-manage-order"><button type="button" class="btn small" data-move-category="up" aria-label="위로">↑</button><button type="button" class="btn small" data-move-category="down" aria-label="아래로">↓</button></div><button type="button" class="cat-drag-handle" draggable="true" aria-label="드래그하여 순서 변경" title="드래그하여 순서 변경">⋮⋮</button><input type="text" value="${esc(c)}" data-original="${esc(c)}"/><span class="cat-manage-count">${countLabel(categoryCount(c))}</span><button class="btn small danger" type="button" data-delete-category="${esc(c)}">삭제</button></div>`).join('')||'<div class="empty" style="height:120px">등록된 카테고리가 없습니다.</div>';
}
function bindCategoryModalDnD(){
  const body=$('categoryModalBody');
  let dragRow=null;
  body.addEventListener('dragstart',e=>{
    const handle=e.target.closest('.cat-drag-handle');
    if(!handle)return;
    dragRow=handle.closest('.cat-manage-row');
    if(!dragRow)return;
    dragRow.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
  });
  body.addEventListener('dragend',()=>{
    dragRow?.classList.remove('dragging');
    dragRow=null;
    body.querySelectorAll('.cat-manage-row.drop-target').forEach(el=>el.classList.remove('drop-target'));
  });
  body.addEventListener('dragover',e=>{
    if(!dragRow)return;
    e.preventDefault();
    const row=e.target.closest('.cat-manage-row');
    if(!row||row===dragRow)return;
    body.querySelectorAll('.cat-manage-row.drop-target').forEach(el=>el.classList.remove('drop-target'));
    row.classList.add('drop-target');
  });
  body.addEventListener('drop',e=>{
    if(!dragRow)return;
    e.preventDefault();
    const target=e.target.closest('.cat-manage-row');
    if(!target||target===dragRow)return;
    const rect=target.getBoundingClientRect();
    if(e.clientY>rect.top+rect.height/2)target.insertAdjacentElement('afterend',dragRow);
    else body.insertBefore(dragRow,target);
    target.classList.remove('drop-target');
  });
}
async function persistCategories(list,docUpdates={}){
  if(!isAdmin())throw new Error('카테고리 관리 권한이 없습니다');
  await set(ref(db,'wikiMeta/categories'),list);
  const docPaths=Object.entries(docUpdates);
  if(docPaths.length){
    const updates=Object.fromEntries(docPaths.map(([id,category])=>[`wikiDocs/${id}/category`,category]));
    await update(ref(db),updates);
  }
}
async function addCategory(name){
  try{
    if(!isAdmin())return toast('카테고리 관리 권한이 없습니다');
    name=(name||'').trim();
    if(!name)return toast('카테고리 이름을 입력하세요');
    if(name==='전체')return toast('"전체"는 사용할 수 없습니다');
    if(state.categories.includes(name))return toast('이미 있는 카테고리입니다');
    await persistCategories([...editableCategories(),name]);
    toast('카테고리 추가됨');
    $('newCategoryInput').value='';
  }catch(e){toast(e.message||'카테고리 추가 실패')}
}
async function saveCategoryEdits(){
  try{
    if(!isAdmin())return toast('카테고리 관리 권한이 없습니다');
    const rows=[...$('categoryModalBody').querySelectorAll('.cat-manage-row input')];
    const newList=[],docUpdates={};
    for(const input of rows){
      const oldName=input.dataset.original||'';
      const newName=input.value.trim();
      if(!newName)return toast('빈 카테고리 이름은 사용할 수 없습니다');
      if(newName==='전체')return toast('"전체"는 사용할 수 없습니다');
      if(newList.includes(newName))return toast('중복된 카테고리 이름이 있습니다');
      newList.push(newName);
      if(oldName&&oldName!==newName)state.docs.filter(d=>d.category===oldName).forEach(d=>{docUpdates[d.id]=newName});
    }
    await persistCategories(newList,docUpdates);
    toast('카테고리 저장 완료');
    closeCategoryModal();
  }catch(e){toast(e.message||'카테고리 저장 실패')}
}
async function deleteCategory(name){
  try{
    if(!isAdmin())return toast('카테고리 관리 권한이 없습니다');
    const count=categoryCount(name);
    const fallback=editableCategories().find(c=>c!==name)||'FAQ / 용어사전';
    const msg=count?`"${name}" 카테고리와 ${count}개 문서를 "${fallback}"(으)로 이동할까요?`:`"${name}" 카테고리를 삭제할까요?`;
    if(!confirm(msg))return;
    const docUpdates={};
    if(count)state.docs.filter(d=>d.category===name).forEach(d=>{docUpdates[d.id]=fallback});
    await persistCategories(editableCategories().filter(c=>c!==name),docUpdates);
    if(state.category===name)state.category='전체';
    toast('카테고리 삭제됨');
  }catch(e){toast(e.message||'카테고리 삭제 실패')}
}
function enrichDoc(d){
  const b=state.bundledMap[d.id];
  return b?{...d, contentPath:b.contentPath, sourceFile:d.sourceFile||b.sourceFile}:d;
}
function categoryCount(category){
  if(category==='전체') return state.docs.length;
  return state.docs.filter(d=>d.category===category).length;
}
function countLabel(n){return `(${String(n).padStart(2,'0')}건)`}
function renderCats(){$('categoryList').innerHTML=state.categories.map(c=>`<button type="button" class="${state.category===c?'active':''}" data-category="${esc(c)}">${esc(c)} <span class="cat-count">${countLabel(categoryCount(c))}</span></button>`).join('')}
function filtered(){const q=state.query.trim().toLowerCase();return state.docs.filter(d=>(state.category==='전체'||d.category===state.category)&&(!q||`${d.title||''} ${d.summary||''} ${d.category||''} ${d.searchText||''}`.toLowerCase().includes(q))).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))}
function stats(){const d=state.docs;$('statTotal').textContent=d.length;$('statHtml').textContent=d.filter(x=>x.contentType==='html').length;$('statManual').textContent=d.filter(x=>(x.type||'').includes('매뉴얼')).length;$('statUpdated').textContent=fmt(d.map(x=>x.updatedAt).filter(Boolean).sort().pop())}
function show(mode){listView.classList.toggle('hidden',mode!=='list');detailView.classList.toggle('hidden',mode!=='detail');formView.classList.toggle('hidden',mode!=='form');window.scrollTo({top:0,behavior:'smooth'})}
function renderList(){show('list');const docs=filtered();const pages=Math.max(1,Math.ceil(docs.length/PAGE_SIZE));if(state.page>pages)state.page=pages;const items=docs.slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE);$('listTitle').textContent=state.category;$('listCount').textContent=docs.length;$('docList').innerHTML=items.length?items.map(card).join(''):`<div class="empty">문서가 없습니다.<br>우측 상단 “샘플 추가/갱신” 또는 HTML 붙여넣기로 등록하세요.</div>`;renderPager(pages);stats();renderCats()}
function card(d){return `<button class="doc" type="button" data-doc-id="${esc(d.id)}"><h4>${esc(d.title||'제목 없음')}</h4><p>${esc(d.summary||'')}</p><div class="meta"><span class="pill purple">${d.contentType==='html'?'HTML':'TEXT'}</span><span class="pill green">${esc(d.category||'-')}</span><span class="pill">${fmt(d.updatedAt)}</span></div></button>`}
function renderPager(p){if(p<=1){$('pager').innerHTML='';return}let h=`<button data-page="${Math.max(1,state.page-1)}">이전</button>`;for(let i=1;i<=p;i++){if(i===1||i===p||Math.abs(i-state.page)<=2)h+=`<button class="${i===state.page?'active':''}" data-page="${i}">${i}</button>`;else if(!h.endsWith('<span>…</span>'))h+='<span>…</span>'}h+=`<button data-page="${Math.min(p,state.page+1)}">다음</button>`;$('pager').innerHTML=h}
async function getHtml(d){
  const merged=enrichDoc(d);
  if(merged.contentPath){const r=await fetch(merged.contentPath,{cache:'no-store'});if(!r.ok)throw new Error('HTML 파일을 불러오지 못했습니다: '+merged.contentPath);return await r.text()}
  if(merged.htmlContent)return merged.htmlContent;
  return '<p>HTML 내용이 없습니다.</p>';
}
function fitFrame(frame){
  try{
    const doc=frame.contentDocument;
    if(!doc)return;
    const h=Math.max(doc.body?.scrollHeight||0, doc.documentElement?.scrollHeight||0, 680);
    frame.style.height=(h+40)+'px';
  }catch(e){frame.style.height='900px'}
}
async function openDoc(id){
  const found=state.docs.find(x=>x.id===id);if(!found)return;const d=enrichDoc(found);state.selected=d;show('detail');
  detailView.innerHTML=`<div class="detail-top"><div><button class="btn small" id="backToListBtn">← 목록으로</button><div class="meta"><span class="pill purple">${d.contentType==='html'?'HTML':'TEXT'}</span><span class="pill green">${esc(d.category||'-')}</span><span class="pill">수정 ${fmt(d.updatedAt)}</span></div><h2>${esc(d.title||'제목 없음')}</h2><p class="summary">${esc(d.summary||'')}</p></div><div class="actions"><button class="btn small" id="editDocBtn">수정</button><button class="btn small" id="downloadHtmlBtn">HTML 다운로드</button><button class="btn small danger" id="deleteDocBtn">삭제</button></div></div>${d.contentType==='html'?`<div class="html-card"><div class="html-toolbar"><b>HTML 본문 보기</b><small>${esc(d.sourceFile||d.contentPath||'')}</small></div><iframe id="htmlFrame" class="html-frame" title="${esc(d.title||'HTML 문서')}" loading="eager"></iframe></div>`:`<div class="wiki-body">${esc(d.body||'')}</div>`}`;
  if(d.contentType==='html'){
    const frame=$('htmlFrame');
    try{
      const html=await getHtml(d);
      frame.srcdoc=html;
      frame.addEventListener('load',()=>{fitFrame(frame);setTimeout(()=>fitFrame(frame),350);setTimeout(()=>fitFrame(frame),1200)});
    }catch(e){frame.replaceWith(Object.assign(document.createElement('div'),{className:'empty',textContent:e.message}))}
  }
}
function infer(t=''){t=t.toLowerCase();if(/하드코딩|hardcoding/.test(t))return'기타 / 하드코딩';if(/커머스|e-shop|주문|배송/.test(t))return'주문 / 커머스 / e-Shop';if(/포인트|point|정산|적립|쿠폰|바우처|이용권|voucher/.test(t))return'포인트 / 쿠폰 / 바우처';if(/통합회원|회원가입|회원|멤버십|리워즈|membership|rewards|로그인|탈퇴/.test(t))return'회원 / 리워즈';if(/eximbay|pg|결제|환불/.test(t))return'결제 / PG / Eximbay';if(/pos|pms|opera|오페라/.test(t))return'POS / PMS / Opera';if(/장애|오류|에러|error/.test(t))return'장애 로그';if(/회의|아젠다|agenda/.test(t))return'회의록 / 아젠다';if(/api|배치|연동|crs|cms|cjagent|다국어|권한|도메인|약관/.test(t))return'API / 배치 / 연동';return'FAQ / 용어사전'}
function openForm(type='standard',doc=null){show('form');const htmlMode=type==='html';formView.innerHTML=`<div class="panel-head"><div><span class="badge">${htmlMode?'HTML IMPORT':'CREATE'}</span><h3>${doc?'문서 수정':'새 문서 등록'}</h3></div><button class="btn small" id="closeFormBtn">닫기</button></div><div class="tabs"><button class="tab ${type==='standard'?'active':''}" data-form-type="standard">일반 문서</button><button class="tab ${type==='markdown'?'active':''}" data-form-type="markdown">Markdown</button><button class="tab ${type==='html'?'active':''}" data-form-type="html">HTML</button></div><form id="docForm" class="form-grid" data-edit-id="${esc(doc?.id||'')}" data-content-type="${htmlMode?'html':'text'}"><div class="field"><label>문서 유형</label><select name="type"><option>운영매뉴얼</option><option ${doc?.type==='HTML 매뉴얼'?'selected':''}>HTML 매뉴얼</option><option>장애사례</option><option>FAQ</option></select></div><div class="field"><label>카테고리</label><select name="category">${editableCategories().map(c=>`<option ${doc?.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div><div class="field full"><label>제목</label><input name="title" value="${esc(doc?.title||'')}" required></div><div class="field full"><label>핵심 요약</label><textarea name="summary">${esc(doc?.summary||'')}</textarea></div><div class="field"><label>원본 파일명/링크</label><input name="sourceFile" value="${esc(doc?.sourceFile||'')}"></div><div class="field"><label>대표 이미지 URL</label><input name="imageUrl" value="${esc(doc?.imageUrl||'')}"></div><div class="field full"><label>${htmlMode?'HTML 원문 붙여넣기':'상세 내용'}</label><textarea class="big" name="body">${esc(htmlMode?(doc?.htmlContent||''):(doc?.body||''))}</textarea></div><div class="actions full"><button class="btn dark" type="button" id="autoSplitBtn">필드 자동분리</button><button class="btn primary" type="submit">저장</button><button class="btn" type="button" id="cancelFormBtn">취소</button></div></form>`}
function autoSplit(){const f=$('docForm'),raw=f.body.value||'';if(f.dataset.contentType==='html'){const p=new DOMParser().parseFromString(raw,'text/html');f.title.value=p.querySelector('title,h1,h2')?.textContent?.trim()||f.title.value||'HTML 문서';f.summary.value=p.querySelector('p')?.textContent?.trim()?.slice(0,180)||f.summary.value;f.type.value='HTML 매뉴얼';f.category.value=infer(p.body?.textContent||raw)}else{const lines=raw.split(/\n/).map(x=>x.trim()).filter(Boolean);if(!f.title.value&&lines[0])f.title.value=lines[0].replace(/^#+\s*/,'').slice(0,90);if(!f.summary.value&&lines[1])f.summary.value=lines[1].slice(0,180);f.category.value=infer(raw)}}
async function saveForm(e){e.preventDefault();const f=e.target,data=Object.fromEntries(new FormData(f).entries()),id=f.dataset.editId||newId(data.title),prev=state.docs.find(d=>d.id===id),now=new Date().toISOString(),isHtml=f.dataset.contentType==='html';const p=isHtml?new DOMParser().parseFromString(data.body||'','text/html'):null;const text=isHtml?(p.body?.textContent||data.body||''):(data.body||'');const doc={...(prev||{}),id,type:data.type,category:data.category,title:data.title,summary:data.summary,sourceFile:data.sourceFile,imageUrl:data.imageUrl,contentType:isHtml?'html':'text',updatedAt:now,createdAt:prev?.createdAt||now,searchText:text.slice(0,20000)};if(isHtml){doc.htmlContent=data.body;delete doc.body;delete doc.contentPath}else{doc.body=data.body;delete doc.htmlContent;delete doc.contentPath}await set(ref(db,`wikiDocs/${id}`),doc);toast('저장 완료');state.selected=doc;openDoc(id)}
async function seed(){try{if(!state.bundledDocs.length)await loadManifest();if(!state.bundledDocs.length)throw new Error('manifest.json을 찾지 못했습니다.');if(!state.appVersion)await loadVersion();const u={};for(const d of state.bundledDocs)u[`wikiDocs/${d.id}`]=d;u['wikiMeta/seedVersion']=state.appVersion?.version||'unknown';u['wikiMeta/appVersion']=state.appVersion||null;await update(ref(db),u);toast(`${state.bundledDocs.length}개 HTML 문서를 갱신했어`)}catch(e){toast(e.message)}}
async function del(){if(!state.selected||!confirm('삭제할까요?'))return;await remove(ref(db,`wikiDocs/${state.selected.id}`));state.selected=null;toast('삭제 완료');renderList()}
async function download(){const d=state.selected;if(!d)return;const content=d.contentType==='html'?await getHtml(d):(d.body||'');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/html;charset=utf-8'}));a.download=(d.title||'wiki-doc').replace(/[\\/:*?"<>|]/g,'_')+'.html';a.click();URL.revokeObjectURL(a.href)}
function backup(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(state.docs,null,2)],{type:'application/json'}));a.download='eseo-wiki-backup-'+today()+'.json';a.click();URL.revokeObjectURL(a.href)}
function subscribe(){if(state.unsubscribe)state.unsubscribe();state.unsubscribe=onValue(ref(db,'wikiDocs'),s=>{state.docs=Object.values(s.val()||{}).map(enrichDoc);$('connectionText').textContent='Firebase Auth / Firebase DB 연결됨';renderList()},e=>toast(e.message))}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPassword').value)}catch(err){toast('로그인 실패: '+err.message)}});
$('logoutBtn').onclick=()=>signOut(auth);$('newDocBtn').onclick=()=>openForm('standard');$('markdownImportBtn').onclick=()=>openForm('markdown');$('htmlImportBtn').onclick=()=>openForm('html');$('seedBtn').onclick=seed;$('backupBtn').onclick=backup;$('categoryManageBtn').onclick=openCategoryModal;$('closeCategoryModalBtn').onclick=closeCategoryModal;$('cancelCategoryModalBtn').onclick=closeCategoryModal;$('saveCategoryModalBtn').onclick=saveCategoryEdits;$('addCategoryBtn').onclick=()=>addCategory($('newCategoryInput').value);$('newCategoryInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addCategory($('newCategoryInput').value)}});$('categoryModal').onclick=e=>{if(e.target.id==='categoryModal')closeCategoryModal()};$('categoryModalBody').onclick=e=>{const del=e.target.closest('[data-delete-category]');if(del){deleteCategory(del.dataset.deleteCategory);return}const move=e.target.closest('[data-move-category]');if(move){moveCategoryRow(move.closest('.cat-manage-row'),move.dataset.moveCategory==='up'?-1:1);return}};bindCategoryModalDnD();$('searchInput').oninput=e=>{state.query=e.target.value;state.page=1;renderList()};$('categoryList').onclick=e=>{const b=e.target.closest('[data-category]');if(b){state.category=b.dataset.category;state.page=1;renderList()}};$('docList').onclick=e=>{const b=e.target.closest('[data-doc-id]');if(b)openDoc(b.dataset.docId)};$('pager').onclick=e=>{const b=e.target.closest('[data-page]');if(b){state.page=+b.dataset.page;renderList()}};document.addEventListener('click',e=>{if(['backToListBtn','cancelFormBtn','closeFormBtn'].includes(e.target.id))renderList();if(e.target.id==='editDocBtn')openForm(state.selected?.contentType==='html'?'html':'standard',state.selected);if(e.target.id==='deleteDocBtn')del();if(e.target.id==='downloadHtmlBtn')download();if(e.target.id==='autoSplitBtn')autoSplit();const t=e.target.closest('[data-form-type]');if(t)openForm(t.dataset.formType)});document.addEventListener('submit',e=>{if(e.target.id==='docForm')saveForm(e)});$('topBtn').onclick=()=>scrollTo({top:0,behavior:'smooth'});addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('categoryModal').classList.contains('hidden'))closeCategoryModal()});
onAuthStateChanged(auth,u=>{state.user=u;appEl.classList.toggle('auth-locked',!u);$('authLoggedOut').classList.toggle('hidden',!!u);$('authLoggedIn').classList.toggle('hidden',!u);document.querySelectorAll('[data-auth-only]').forEach(el=>el.classList.toggle('hidden',!u));syncAdminUI();if(u){$('userEmail').textContent=u.email||'';$('connectionText').textContent='Firebase Auth 연결됨 / DB 동기화중';subscribe();subscribeCategories()}else{$('connectionText').textContent='로그아웃됨';state.docs=[];closeCategoryModal();if(state.unsubscribe)state.unsubscribe();if(state.catUnsub)state.catUnsub();applyCategories(null)}});
await loadManifest();await loadVersion();renderCats();
