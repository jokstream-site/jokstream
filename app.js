/* JOKSTREAM — unified live TV, movies and series experience. */
const JOKFLIX_API = "https://jokflix.abdonarjah.workers.dev";
const JOKSTREAM_API = "https://jokstream-api.abdonarjah.workers.dev";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/";
const VIDSRC_HOSTS = ["https://vidsrc.sh"];
const VIDSRC = VIDSRC_HOSTS[0];
const $ = (id) => document.getElementById(id);
const state = {
  route: "home", browseType: "movie", browsePage: 1, browseSort: "popularity.desc",
  genre: "", current: null, currentType: "movie", currentEpisode: null, currentDetails: null,
  liveChannels: [], liveRendered: 0, liveCategories: [], liveCategory: "", liveSearch: "", liveEngine: null,
  subtitleContext: null, selectedSubtitle: null, progress: {}, myList: readStore("jokstream_mylist", []),
  lastResults: [], searchQuery: "", currentRate: 1
};
function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } }
function writeStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function toast(message, error = false) { const el=document.createElement("div");el.className="toast"+(error?" error":"");el.textContent=message;$("toastRegion").append(el);setTimeout(()=>el.remove(),3200); }
function safe(value) { return String(value ?? "").replace(/[<>]/g,"").trim(); }
function titleOf(item) { return item?.title || item?.name || "Untitled"; }
function yearOf(item) { return String(item?.release_date || item?.first_air_date || "").slice(0,4); }
function image(path,size="w500") { return path ? (/^https?:\\/\\//i.test(path)?path:TMDB_IMAGE+size+path) : ""; }
function mediaType(item, fallback="movie") { return item?.media_type === "tv" || item?.first_air_date || fallback === "tv" ? "tv" : "movie"; }
async function tmdb(path, params={}) {
  const url = new URL(JOKFLIX_API + "/api/" + path.replace(/^\/+/, ""));
  for (const [key,value] of Object.entries({language:"en-US",include_adult:"false",...params})) if(value!==undefined&&value!==null&&value!=="") url.searchParams.set(key,String(value));
  const response = await fetch(url, {headers:{Accept:"application/json"}});
  if (!response.ok) { let detail=""; try { const body=await response.json();detail=body.status_message||body.error||""; } catch {} throw new Error(detail || "TMDB request failed ("+response.status+")"); }
  return response.json();
}
async function apiJson(url, params={}) {
  const target = new URL(url);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=="")target.searchParams.set(k,String(v));});
  const response = await fetch(target);
  if(!response.ok){let message="Request failed ("+response.status+")";try{message=(await response.json()).error||message}catch{}throw new Error(message);}
  return response.json();
}
function card(item,type="movie") {
  const el=document.createElement("article");el.className="poster-card";el.tabIndex=0;
  const poster=document.createElement("img");poster.className="poster-image";poster.loading="lazy";poster.alt=titleOf(item);poster.src=image(item.poster_path,"w342");poster.onerror=()=>{poster.style.opacity=".15";};
  const info=document.createElement("div");info.className="poster-info";
  const name=document.createElement("div");name.className="poster-title";name.textContent=titleOf(item);
  const sub=document.createElement("div");sub.className="poster-sub";
  const year=document.createElement("span");year.textContent=yearOf(item)||"Explore";
  const rating=document.createElement("span");rating.className="poster-rating";rating.textContent="★ "+Number(item.vote_average||0).toFixed(1);
  sub.append(year,rating);info.append(name,sub);el.append(poster,info);
  const open=()=>showDetails(item,type);el.addEventListener("click",open);el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
  return el;
}
function fillRow(id,items,type) { const host=$(id);host.replaceChildren();const rows=(items||[]).filter(x=>x.poster_path).slice(0,18);if(!rows.length){host.innerHTML='<p class="muted">No titles available right now.</p>';return;}rows.forEach(x=>host.append(card(x,type))); }
async function home() {
  const jobs=[
    ["trending/movie/week","trendingMovies","movie"],
    ["tv/popular","popularSeries","tv"],
    ["movie/top_rated","topMovies","movie"],
    ["trending/tv/week","trendingSeries","tv"]
  ];
  await Promise.all(jobs.map(async([path,id,type])=>{try{const d=await tmdb(path);fillRow(id,d.results,type);}catch(e){$(id).innerHTML='<p class="muted">Unable to load this collection.</p>';console.warn(path,e);}}));
  try {
    const d=await tmdb("trending/movie/week");const hero=(d.results||[]).find(x=>x.backdrop_path)||d.results?.[0];
    if(hero){$("heroBackdrop").style.backgroundImage="url('"+image(hero.backdrop_path,"original")+"')";$("heroTitle").innerHTML=escapeHtml(titleOf(hero)).replace(/\s+/g,"<br>");$("heroOverview").textContent=hero.overview||"Discover your next favourite story."; $("heroMeta").replaceChildren();[$("heroMeta")].forEach(()=>{});const bits=[yearOf(hero),Number(hero.vote_average||0).toFixed(1)+" ★",hero.original_language?.toUpperCase()].filter(Boolean);bits.forEach(v=>{const s=document.createElement("span");s.textContent=v;$("heroMeta").append(s);});$("heroPlay").onclick=()=>showDetails(hero,"movie");$("heroInfo").onclick=()=>showDetails(hero,"movie");}
  } catch(e){console.warn("Hero unavailable",e);}
}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function showView(route) {
  state.route=route;
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  const target=route==="live"?"liveView":route==="movies"||route==="series"?"browseView":route==="mylist"?"mylistView":route==="search"?"searchView":"homeView";
  $(target).classList.add("active");
  document.querySelectorAll("[data-route]").forEach(b=>b.classList.toggle("active",b.dataset.route===route));
  if(route==="movies"||route==="series"){state.browseType=route==="series"?"tv":"movie";state.browsePage=1;state.genre="";$("browseTitle").textContent=route==="series"?"Series":"Movies";$("browseEyebrow").textContent=route==="series"?"SERIES COLLECTION":"EXPLORE THE LIBRARY";$("browseDescription").textContent=route==="series"?"Discover acclaimed shows and new seasons.":"Explore films from every genre and era.";buildGenres();loadBrowse(true);}
  if(route==="live")loadLive();
  if(route==="mylist")renderMyList();
}
function buildGenres(){
  const host=$("genreFilters");host.replaceChildren();
  const type=state.browseType;const path=type==="tv"?"genre/tv/list":"genre/movie/list";
  const staticGenres=type==="tv"?[[10759,"Action & Adventure"],[35,"Comedy"],[18,"Drama"],[10765,"Sci-Fi & Fantasy"],[80,"Crime"],[9648,"Mystery"],[10768,"War & Politics"]]:[[28,"Action"],[12,"Adventure"],[16,"Animation"],[35,"Comedy"],[80,"Crime"],[18,"Drama"],[14,"Fantasy"],[27,"Horror"],[878,"Sci-Fi"],[53,"Thriller"]];
  const all=document.createElement("button");all.className="genre-pill active";all.textContent="All";all.onclick=()=>{state.genre="";host.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===all));state.browsePage=1;loadBrowse(true);};host.append(all);
  staticGenres.forEach(([id,label])=>{const b=document.createElement("button");b.className="genre-pill";b.textContent=label;b.onclick=()=>{state.genre=String(id);host.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));state.browsePage=1;loadBrowse(true);};host.append(b);});
}
async function providerCatalogPage(type,page=1){
 const endpoint=type==="tv"?"tvshows":"movies";
 const hosts=["https://vidsrc.sh","https://vidsrc2.ru","https://vidsrc.ir"];
 const failures=[];
 for(const host of hosts){
  const url=host+"/"+endpoint+"/latest/page-"+page+".json";
  try{
   const r=await fetch(url,{method:"GET",mode:"cors",credentials:"omit",headers:{Accept:"application/json"},cache:"no-store",referrerPolicy:"strict-origin-when-cross-origin",signal:AbortSignal.timeout(12000)});
   if(!r.ok){failures.push(host+" ("+r.status+")");continue;}
   const d=await r.json();
   if(!Array.isArray(d.result)){failures.push(host+" (invalid catalogue response)");continue;}
   return d;
  }catch(e){
   failures.push(host+" ("+(e&&e.name==="TimeoutError"?"timeout":"network/CORS error")+")");
  }
 }
 throw new Error("VidSrc catalogue unavailable from this browser. "+failures.join("; "));
}
function providerFallback(entry,type){
 const title=String(entry.title||"").replace(/\\s+\\d{4}\\s*$/,"").trim()||"Untitled";
 const id=entry.tmdb_id?Number(entry.tmdb_id):entry.imdb_id;
 return {id,title,name:type==="tv"?title:undefined,media_type:type,imdb_id:entry.imdb_id||"",vidsrc_quality:entry.quality,vidsrc_added:entry.time_added,overview:"Details are loading from TMDB.",poster_path:null,backdrop_path:null,vote_average:0};
}
async function resolveProviderItem(entry,type){
 const id=entry.imdb_id||entry.tmdb_id;if(!id)return null;
 let info=null;
 for(const host of [VIDSRC,"https://vidsrc.ir","https://vidsrc2.ru"]){
  try{
   const response=await fetch(host+"/info/"+type+"/"+encodeURIComponent(id)+".json",{headers:{Accept:"application/json"},mode:"cors",credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(10000)});
   if(response.status===404)return null;if(!response.ok)continue;
   const data=await response.json();if(data.status_code===404||data.error)return null;info=data;break;
  }catch(e){continue;}
 }
 if(!info)return null;
 let details={};const tmdbId=info.tmdb_id||entry.tmdb_id;
 if(tmdbId){try{details=await tmdb(type+"/"+tmdbId);}catch{}}
 const fallback=providerFallback(entry,type);
 return {...fallback,...details,id:tmdbId?Number(tmdbId):(info.imdb_id||entry.imdb_id),tmdb_id:tmdbId||"",imdb_id:info.imdb_id||entry.imdb_id||"",title:info.title||details.title||details.name||fallback.title,name:type==="tv"?(info.title||details.name||fallback.title):undefined,poster_path:info.poster||details.poster_path||null,release_date:type==="movie"?(info.year?String(info.year)+"-01-01":details.release_date||""):undefined,first_air_date:type==="tv"?(info.year?String(info.year)+"-01-01":details.first_air_date||""):undefined,vote_average:Number(info.imdb_rating||details.vote_average||0),vidsrc_quality:info.quality||entry.quality||"",vidsrc_added:entry.time_added||"",vidsrc_seasons:Array.isArray(info.seasons)?info.seasons:[],vidsrc_available:true,overview:details.overview||("Available on VidSrc · "+(info.quality||entry.quality||"Quality varies by source")+".")};
}
async function loadBrowse(reset=false){
 if(reset){state.browseLoading=false;state.browseRetry=false;$("browseGrid").replaceChildren();state.browsePage=1;state.browseRequest=(state.browseRequest||0)+1;}
 if(state.browseLoading)return;
 const request=state.browseRequest||0,type=state.browseType,page=state.browsePage;
 state.browseLoading=true;state.browseRetry=false;$("sortSelect").disabled=true;$("sortSelect").innerHTML='<option>Recently added · VidSrc catalogue</option>';$("browseCount").textContent="Loading page "+page+" · up to 50 titles…";$("loadMoreTitles").hidden=true;$("loadMoreTitles").textContent="Loading next 50 titles…";
 try{
  const d=await providerCatalogPage(type,page);if(request!==state.browseRequest)return;
  const entries=d.result||[];if(!entries.length){$("browseCount").textContent="No titles found in this catalogue page.";$("browseGrid").innerHTML='<div class="empty-state">No titles are available on this page.</div>';return;}
  $("browseCount").textContent="VidSrc catalogue · "+entries.length+" titles in this page · Loading details progressively…";
  let shown=0,matched=0;
  for(let i=0;i<entries.length;i+=8){
   const batch=entries.slice(i,i+8);
   const resolved=await Promise.all(batch.map(async entry=>{try{return await Promise.race([resolveProviderItem(entry,type),new Promise((_,reject)=>setTimeout(()=>reject(new Error("VidSrc info timeout")),12000))]);}catch{return null;}}));
   if(request!==state.browseRequest)return;
   const filtered=resolved.filter(Boolean);
   filtered.forEach(item=>$("browseGrid").append(card(item,type)));shown+=filtered.length;matched+=filtered.length;
   $("browseCount").textContent="VidSrc catalogue · "+shown+" of "+entries.length+" titles loaded";
  }
  $("browseCount").textContent="VidSrc catalogue · Page "+page+" of "+Number(d.pages||1).toLocaleString()+" · "+matched+" titles loaded · 50 per page";
  $("loadMoreTitles").hidden=!d.pages||page>=d.pages;$("loadMoreTitles").textContent=page>=Number(d.pages||page)?"Catalogue complete":"Scroll to load the next 50";
  if(!matched)$("browseGrid").innerHTML='<div class="empty-state">No playable titles were verified on this VidSrc page. Try the next page.</div>';
 }catch(e){
  if(request!==state.browseRequest)return;
  $("browseCount").textContent="Catalogue connection failed";
  $("browseGrid").innerHTML='<div class="empty-state">Could not load VidSrc catalogue: '+escapeHtml(e.message)+' · Please retry.</div>';
  state.browseRetry=true;$("loadMoreTitles").hidden=false;$("loadMoreTitles").textContent="Retry loading this page";toast(e.message,true);
 }finally{if(request===state.browseRequest)state.browseLoading=false;}
}
async function showDetails(item,type="movie"){
  state.current=item;state.currentType=type==="tv"||type==="series"?"tv":"movie";state.currentEpisode=null;state.selectedSubtitle=null;
  $("detailsModal").classList.add("open");$("detailsModal").setAttribute("aria-hidden","false");
  $("detailsTitle").textContent=titleOf(item);$("detailsOverview").textContent=item.overview||"Loading title details…";
  $("detailsBackdrop").style.backgroundImage=item.backdrop_path?"url('"+image(item.backdrop_path,"w1280")+"')":"none";
  $("detailsType").textContent=state.currentType==="tv"?"SERIES DETAILS":"MOVIE DETAILS";
  $("detailsMeta").textContent=[yearOf(item),item.vote_average?"★ "+Number(item.vote_average).toFixed(1):"",item.original_language?.toUpperCase()].filter(Boolean).join(" · ");
  $("detailsFacts").replaceChildren();$("detailsCast").textContent="Loading cast…";$("similarRow").replaceChildren();$("seasonsPanel").hidden=true;$("detailsTrailer").hidden=true;
  const path=state.currentType+"/"+item.id;
  try{
    const d=await tmdb(path,{append_to_response:"credits,videos,similar,external_ids"});
    state.currentDetails=d;$("detailsTitle").textContent=titleOf(d);$("detailsOverview").textContent=d.overview||"No synopsis is available.";
    $("detailsTagline").textContent=d.tagline||"";
    const facts=[["RELEASE",yearOf(d)||"—"],["RATING",d.vote_average?Number(d.vote_average).toFixed(1)+" / 10":"—"],["STATUS",d.status||"—"],["LANGUAGE",d.original_language?.toUpperCase()||"—"]];
    if(state.currentType==="movie"&&d.runtime)facts.push(["RUNTIME",d.runtime+" min"]);
    if(state.currentType==="tv"&&d.number_of_seasons)facts.push(["SEASONS",d.number_of_seasons]);
    $("detailsFacts").replaceChildren(...facts.map(([k,v])=>{const f=document.createElement("div");f.className="fact";const a=document.createElement("small");a.textContent=k;const b=document.createElement("b");b.textContent=v;f.append(a,b);return f;}));
    const cast=(d.credits?.cast||[]).slice(0,12);$("detailsCast").replaceChildren(...cast.map(p=>{const s=document.createElement("span");s.className="cast-chip";s.textContent=p.name;return s;}));if(!cast.length)$("detailsCast").textContent="Cast information unavailable.";
    const trailer=(d.videos?.results||[]).find(v=>v.site==="YouTube"&&v.type==="Trailer"&&v.key)|| (d.videos?.results||[]).find(v=>v.site==="YouTube"&&v.key);const trailerHost=$("detailsTrailerFrame");trailerHost.replaceChildren();trailerHost.hidden=!trailer;if(trailer){const frame=document.createElement("iframe");frame.src="https://www.youtube-nocookie.com/embed/"+encodeURIComponent(trailer.key)+"?rel=0&modestbranding=1";frame.title=titleOf(d)+" official trailer";frame.allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";frame.allowFullscreen=true;frame.loading="lazy";frame.referrerPolicy="strict-origin-when-cross-origin";trailerHost.append(frame);$("detailsTrailer").hidden=false;$("detailsTrailer").textContent="▶ Play trailer";$("detailsTrailer").onclick=()=>trailerHost.scrollIntoView({behavior:"smooth",block:"center"});}else{$("detailsTrailer").hidden=true;}
    const similar=(d.similar?.results||[]).filter(x=>x.poster_path).slice(0,12);similar.forEach(x=>$("similarRow").append(card(x,state.currentType)));
    if(state.currentType==="tv"){const seasons=(d.seasons||[]).filter(s=>s.season_number>=0);$("seasonsPanel").hidden=false;$("seasonSelect").replaceChildren(...seasons.map(s=>{const o=document.createElement("option");o.value=s.season_number;o.textContent=s.name||"Season "+s.season_number;return o;}));$("seasonSelect").onchange=()=>loadEpisodes(d.id,Number($("seasonSelect").value));const first=seasons.find(s=>s.season_number>0)||seasons[0];if(first){$("seasonSelect").value=first.season_number;loadEpisodes(d.id,first.season_number);}}
  }catch(e){$("detailsOverview").textContent=e.message;}
  $("detailsList").textContent=state.myList.some(x=>x.id===item.id&&x.type===state.currentType)?"✓ In My List":"＋ My List";
  $("detailsList").onclick=()=>toggleMyList(item,state.currentType);
  $("detailsPlay").onclick=()=>{if(state.currentType==="tv"){const s=Number($("seasonSelect").value||1);const firstEpisode=Number($("episodeList").querySelector("[data-episode]")?.dataset.episode||1);playVOD(state.currentDetails||item,"tv",s,firstEpisode);}else playVOD(state.currentDetails||item,"movie");};
}
async function loadEpisodes(id,season){
  $("episodeList").innerHTML='<p class="muted">Loading episodes…</p>';
  try{const d=await tmdb("tv/"+id+"/season/"+season);$("episodeList").replaceChildren();(d.episodes||[]).forEach(ep=>{const b=document.createElement("button");b.className="episode-row";b.dataset.episode=ep.episode_number;const imgEl=document.createElement("img");imgEl.src=image(ep.still_path,"w300");imgEl.alt="";const copy=document.createElement("span");const title=document.createElement("b");title.textContent=ep.episode_number+". "+ep.name;const sub=document.createElement("small");sub.textContent=ep.overview||"Play this episode";copy.append(title,sub);b.append(imgEl,copy);b.onclick=()=>playVOD(state.currentDetails,"tv",season,ep.episode_number);$("episodeList").append(b);});if(!d.episodes?.length)$("episodeList").textContent="No episodes are listed for this season.";
  }catch(e){$("episodeList").textContent=e.message;}
}
function toggleMyList(item,type){
  const key=String(item.id),found=state.myList.findIndex(x=>String(x.id)===key&&x.type===type);
  if(found>=0){state.myList.splice(found,1);toast("Removed from My List.");}else{state.myList.unshift({id:item.id,type,title:titleOf(item),poster_path:item.poster_path,backdrop_path:item.backdrop_path,release_date:item.release_date||item.first_air_date,vote_average:item.vote_average});toast("Added to My List.");}
  writeStore("jokstream_mylist",state.myList);$("detailsList").textContent=state.myList.some(x=>String(x.id)===key&&x.type===type)?"✓ In My List":"＋ My List";
}
async function renderMyList(){
  const host=$("myListGrid");host.replaceChildren();
  if(!state.myList.length){host.innerHTML='<div class="empty-state">Your list is empty. Add a movie or series to keep it here.</div>';return;}
  for(const item of state.myList){let full=item;try{full=await tmdb(item.type+"/"+item.id);}catch{}host.append(card(full,item.type));}
}
function closeModal(id){$(id).classList.remove("open");$(id).setAttribute("aria-hidden","true");if(id==="detailsModal"){$("detailsTrailerFrame")?.replaceChildren();$("detailsTrailerFrame").hidden=true;}}
function progressKey(type,id,season,episode){return "jokstream_progress:"+type+":"+id+(type==="tv"?":"+season+":"+episode:"");}
function buildEmbedUrl(item,type,season,episode){
  const mediaId=item.imdb_id||item.id;
  const path=type==="tv"?"/embed/tv/"+mediaId+(season?"/"+season+"/"+episode:""):"/embed/movie/"+mediaId;
  const url=new URL(path,VIDSRC);
  url.searchParams.set("autoplay","1");
  url.searchParams.set("colour","00ff9d");
  const preferred=String($("subtitleLanguage")?.value||"ar,es,fr").toLowerCase().split(",").map(x=>x.trim()).filter(x=>/^[a-z]{2,3}$/.test(x));
  const subtitlePriority=[...new Set(preferred.length?preferred:["ar","es","fr"])].slice(0,3);
  url.searchParams.set("ds_lang",subtitlePriority.join(","));
  // VidSrc loads custom subtitle files directly in the viewer; keep the embed itself direct.
  if(state.selectedSubtitle?.url){
    url.searchParams.set("sub_url",state.selectedSubtitle.url);
    url.searchParams.set("sub_label",state.selectedSubtitle.label||"External subtitle");
    url.searchParams.set("sub_lang",state.selectedSubtitle.language||"en");
  }
  if(type==="tv")url.searchParams.set("autonext","1");
  return url.toString();
}
function playVOD(item,type="movie",season=null,episode=null){
  if(!item)return;state.current=item;state.currentType=type;state.currentEpisode=type==="tv"?{season,episode}:null;
  closeModal("detailsModal");$("playerModal").classList.add("open");$("playerModal").setAttribute("aria-hidden","false");
  $("playerTitle").textContent=titleOf(item)+(type==="tv"&&season?" · S"+season+" E"+episode:"");
  $("playerState").textContent="LOADING";$("embedPlaceholder").hidden=true;
  $("embedStage").querySelectorAll("iframe,.player-shield").forEach(x=>x.remove());
  const frame=document.createElement("iframe");frame.id="vidFrame";frame.title="JOKSTREAM video player";frame.src=buildEmbedUrl(item,type,season,episode);
  frame.allow="autoplay; fullscreen; picture-in-picture; encrypted-media";frame.allowFullscreen=true;frame.referrerPolicy="strict-origin-when-cross-origin";frame.loading="eager";
  frame.addEventListener("load",()=>{$("playerState").textContent="TAP PLAY INSIDE PLAYER";});
  frame.addEventListener("error",()=>{$("playerState").textContent="PLAYER FAILED TO LOAD";});
  $("embedStage").append(frame);
  $("playerProgress").textContent="Progress is stored on this device when playback events are received.";
  $("playbackRate").textContent=state.currentRate+"×";
}
function setPlayerShield(enabled){
 const stage=$("embedStage");if(!stage)return;
 const existing=stage.querySelector(".player-shield");
 const toggle=$("playerClickToggle");
 if(toggle){toggle.textContent=enabled?"Allow player clicks":"Protect clicks";toggle.title=enabled?"Allow clicks inside VidSrc for verification":"Enable click protection over the player";toggle.setAttribute("aria-pressed",String(enabled));}
 if(enabled&&!existing){
  const layer=document.createElement("div");
  layer.className="player-shield";
  layer.setAttribute("aria-label","JOKSTREAM click protection");
  layer.title="JOKSTREAM click protection is active. Use the remote controls below.";
  stage.append(layer);
 }else if(!enabled&&existing){existing.remove();}
}
function sendPlayerCommand(action,value){
  const frame=$("embedStage").querySelector("iframe");
  if(!frame?.contentWindow){toast("The player is not ready yet.",true);return;}
  const message={player:true,action};if(value!==undefined)message.value=value;
  // Send commands only to the direct VidSrc iframe, never through a proxy or wildcard target.
  let targetOrigin="https://vidsrc.sh";
  try{targetOrigin=new URL(frame.src).origin;}catch{}
  frame.contentWindow.postMessage(message,targetOrigin);
}
window.addEventListener("message",event=>{
  const activeFrame=$("embedStage")?.querySelector("iframe");
  if(!activeFrame||event.source!==activeFrame.contentWindow)return;
  let eventHost="";try{eventHost=new URL(event.origin).hostname.toLowerCase()}catch{return}
  if(!["vidsrc.sh","vidsrc2.ru","vidsrc.ir"].includes(eventHost))return;
  let payload=event.data;if(typeof payload==="string"){try{payload=JSON.parse(payload)}catch{return}}
  if(!payload||payload.type!=="PLAYER_EVENT"||!payload.data)return;
  const data=payload.data,info=data.player_info||{},status=data.player_status||"";
  if(status){$("playerState").textContent=status.toUpperCase();}
  if(status==="playing")setPlayerShield(true);
  const progress=Number(data.player_progress),duration=Number(data.player_duration);
  if(Number.isFinite(progress)&&progress>=0&&state.current){const p={time:Math.floor(progress),duration:Number.isFinite(duration)?Math.floor(duration):0,updatedAt:Date.now()};const key=progressKey(state.currentType,state.current.id,info.season||state.currentEpisode?.season,info.episode||state.currentEpisode?.episode);localStorage.setItem(key,JSON.stringify(p));$("playerProgress").textContent="Resume point saved · "+formatTime(progress)+(duration>0?" / "+formatTime(duration):"");}
  if(status==="completed"&&state.currentType==="tv"&&state.currentEpisode)toast("Episode completed. Choose the next episode when you're ready.");
});
function formatTime(s){const n=Math.max(0,Math.floor(s));return Math.floor(n/3600)+":"+String(Math.floor(n%3600/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");}
async function searchSubtitles(){
  if(!state.current){toast("Start a title first.",true);return;}
  const lang=$("subtitleLanguage").value.trim()||"en,ar",d=state.currentDetails||state.current;
  const params={query:titleOf(d),languages:lang,type:state.currentType,year:yearOf(d)};
  if(d.external_ids?.imdb_id){params[state.currentType==="tv"?"parent_imdb_id":"imdb_id"]=d.external_ids.imdb_id;}
  if(state.currentEpisode){params.season_number=state.currentEpisode.season;params.episode_number=state.currentEpisode.episode;}
  $("subtitleResults").innerHTML='<p class="muted">Searching subtitle providers…</p>';
  try{
    const result=await apiJson(JOKSTREAM_API+"/api/subtitles",params),items=result.items||[];
    $("subtitleResults").replaceChildren();
    if(!items.length){$("subtitleResults").innerHTML='<p class="muted">No matching external subtitles were found. Built-in player subtitles are still available.</p>';return;}
    items.forEach(item=>(item.files||[]).forEach(file=>{
      const row=document.createElement("div");row.className="subtitle-result";const info=document.createElement("div");const name=document.createElement("b");name.textContent=(item.language||"Unknown").toUpperCase()+" · "+(file.file_name||item.release||"Subtitle");const sub=document.createElement("small");sub.textContent=(item.download_count||0).toLocaleString()+" downloads"+(item.hearing_impaired?" · SDH":"");info.append(name,sub);
      const button=document.createElement("button");button.textContent="Use subtitle";button.onclick=()=>attachSubtitle(item,file);row.append(info,button);$("subtitleResults").append(row);
    }));
  }catch(e){$("subtitleResults").textContent="Subtitle search unavailable: "+e.message;}
}
function attachSubtitle(item,file){
  const url=JOKSTREAM_API+"/api/subtitles/download?file_id="+encodeURIComponent(file.file_id);
  state.selectedSubtitle={url,label:item.language.toUpperCase()+" · "+(file.file_name||"External subtitle"),language:item.language||"en"};
  closeModal("subtitleModal");
  if(state.current){const ep=state.currentEpisode;playVOD(state.current,state.currentType,ep?.season||null,ep?.episode||null);}
  toast("External subtitle selected. The player will load it when supported.");
}
function openSubtitles(){if(!state.current){toast("Open a movie or series first.",true);return;}$("subtitleModal").classList.add("open");$("subtitleModal").setAttribute("aria-hidden","false");$("subtitleResults").innerHTML='<p class="muted">Choose your preferred languages and search for available subtitles.</p>';}
function applySubtitlePreferences(){if(!state.current){toast("Open a movie or series first.",true);return;}const frame=$("embedStage").querySelector("iframe");if(!frame){toast("The player is not ready yet.",true);return;}const episode=state.currentEpisode;frame.src=buildEmbedUrl(state.current,state.currentType,episode?.season,episode?.episode);setPlayerShield(false);$("playerState").textContent="UPDATING SUBTITLES";closeModal("subtitleModal");toast("Subtitle language priority updated. Restart playback if needed.");}
function normalizeChannel(item){
  const id=item.stream_id??item.id??item.streamId;
  return {id:String(id??""),name:safe(item.name||item.title||"Unknown channel"),category:String(item.category_id??item.categoryId??""),categoryName:safe(item.category_name||item.categoryName||"Other"),logo:item.stream_icon||item.streamIcon||item.logo||"",country:item.country||""};
}
async function loadLive(){
 if(state.liveChannels.length){renderChannels();return;}
 $("liveStatus").textContent="Loading full channel catalogue…";
 try{
  const first=await apiJson(JOKSTREAM_API+"/api/catalog",{kind:"live",page:1,limit:100});if(!first.ok)throw new Error(first.error||"Channel catalogue unavailable");
  const all=[...(first.items||[])],pages=Math.ceil(Number(first.total||all.length)/100);
  for(let start=2;start<=pages;start+=8){const nums=Array.from({length:Math.min(8,pages-start+1)},(_,i)=>start+i);const batch=await Promise.all(nums.map(page=>apiJson(JOKSTREAM_API+"/api/catalog",{kind:"live",page,limit:100})));batch.forEach(x=>all.push(...(x.items||[])));}
  state.liveChannels=all.map(normalizeChannel).filter(x=>x.id);state.liveCategories=first.categories||[];state.liveRendered=0;
  $("liveCount").textContent=state.liveChannels.length.toLocaleString();$("liveStatus").textContent=state.liveChannels.length?"Full channel catalogue ready":"No channels published by provider.";renderCategories();renderChannels();
 }catch(e){$("liveStatus").textContent="Channel service unavailable";$("channelList").innerHTML='<div class="empty-state">Could not load channels. '+escapeHtml(e.message)+'</div>';toast("Live TV connection failed.",true);}
}
function renderCategories(){
  const host=$("channelCategories");host.replaceChildren();
  const all=document.createElement("button");all.className="category-pill";all.dataset.category="";all.textContent="All channels";all.onclick=()=>{state.liveCategory="";renderCategories();renderChannels();};all.classList.toggle("active",!state.liveCategory);host.append(all);
  state.liveCategories.forEach(cat=>{const id=String(cat.category_id??cat.id??"");const b=document.createElement("button");b.className="category-pill";b.dataset.category=id;b.textContent=cat.category_name||cat.name||"Category";b.onclick=()=>{state.liveCategory=id;renderCategories();renderChannels();};b.classList.toggle("active",id===state.liveCategory);host.append(b);});
}
function appendChannelRows(rows){
 const host=$("channelList"),start=state.liveRendered||0,chunk=rows.slice(start,start+200);
 chunk.forEach(c=>{const b=document.createElement("button");b.className="channel-row";b.dataset.id=c.id;const logo=document.createElement("span");logo.className="channel-logo";
 if(c.logo&&/^https?:\/\//i.test(c.logo)){const im=document.createElement("img");im.src=c.logo;im.alt="";im.loading="lazy";im.onerror=()=>{logo.textContent=c.name.slice(0,1);};logo.append(im);}else logo.textContent=c.name.slice(0,1).toUpperCase();
 const info=document.createElement("span"),name=document.createElement("b"),meta=document.createElement("small");info.style.minWidth="0";name.className="channel-name";name.textContent=c.name;meta.className="channel-meta";meta.textContent=c.categoryName;info.append(name,meta);const play=document.createElement("span");play.className="channel-play";play.textContent="▶";b.append(logo,info,play);b.onclick=()=>playLive(c);host.append(b);});
 state.liveRendered=start+chunk.length;
 if(state.liveRendered<rows.length){const more=document.createElement("button");more.className="button button-glass load-more-channels";more.textContent="Load more channels · "+(rows.length-state.liveRendered).toLocaleString()+" remaining";more.onclick=()=>{more.remove();appendChannelRows(rows);};host.append(more);}
}
function renderChannels(){
 const host=$("channelList"),q=state.liveSearch.toLowerCase(),rows=state.liveChannels.filter(c=>(!state.liveCategory||c.category===state.liveCategory)&&(!q||(c.name+" "+c.categoryName+" "+c.country).toLowerCase().includes(q)));
 $("channelResults").textContent=rows.length.toLocaleString()+" results";host.replaceChildren();state.liveRendered=0;if(!rows.length){host.innerHTML='<div class="empty-state">No channels match your search.</div>';return;}appendChannelRows(rows);
}
function stopLive(){if(state.liveEngine){try{state.liveEngine.destroy();}catch{}state.liveEngine=null;}const video=$("liveVideo");video.pause();video.removeAttribute("src");video.load();}
function playLive(channel){
  stopLive();document.querySelectorAll(".channel-row").forEach(x=>x.classList.toggle("active",x.dataset.id===channel.id));
  $("liveNowTitle").textContent=channel.name;$("liveNowMeta").textContent=channel.categoryName;$("livePlaceholder").hidden=true;$("liveStatus").textContent="Connecting to live stream…";
  const video=$("liveVideo"),base=JOKSTREAM_API+"/stream/live/"+encodeURIComponent(channel.id)+".ts";
  if(window.mpegts&&mpegts.isSupported()){
    const player=mpegts.createPlayer({type:"mpegts",isLive:true,url:base},{enableWorker:true,enableStashBuffer:true,stashInitialSize:128});
    state.liveEngine=player;player.attachMediaElement(video);player.load();player.play().then(()=>$("liveStatus").textContent="Live stream connected").catch(()=>{$("liveStatus").textContent="Tap play to start the stream";});
    player.on(mpegts.Events.ERROR,()=>{if(state.liveEngine!==player)return;player.destroy();state.liveEngine=null;playLiveHlsFallback(channel);});
  }else playLiveHlsFallback(channel);
}
function playLiveHlsFallback(channel){
  const video=$("liveVideo"),url=JOKSTREAM_API+"/stream/live/"+encodeURIComponent(channel.id)+".m3u8";
  if(video.canPlayType("application/vnd.apple.mpegurl")){video.src=url;video.play().then(()=>$("liveStatus").textContent="Live stream connected").catch(()=>$("liveStatus").textContent="Tap play to start the stream");}
  else{$("liveStatus").textContent="This browser cannot play the selected live format.";$("livePlaceholder").hidden=false;}
}
function renderSearchResults(items){
  const host=$("searchGrid");host.replaceChildren();state.lastResults=items||[];
  if(!items?.length){host.innerHTML='<div class="empty-state">No matching movies or series were found.</div>';return;}
  items.filter(x=>["movie","tv"].includes(x.media_type)||x.title||x.name).forEach(x=>host.append(card(x,mediaType(x))));
}
async function runSearch(query){
  const q=query.trim();if(q.length<2)return;state.searchQuery=q;showView("search");$("searchHeading").textContent="Results for “"+q+"”";
  try{const d=await tmdb("search/multi",{query:q,page:1});renderSearchResults((d.results||[]).filter(x=>["movie","tv"].includes(x.media_type)&&x.poster_path));}
  catch(e){$("searchGrid").innerHTML='<div class="empty-state">Search unavailable: '+escapeHtml(e.message)+'</div>';}
}
function setupPopupProtection(){
  const original=window.open;
  window.open=function(url,target,features){
    try{const dest=new URL(url||"about:blank",location.href);if(dest.origin!==location.origin&&!["https://www.youtube.com","https://youtube.com","https://youtu.be"].includes(dest.origin)){console.info("JOKSTREAM blocked a page-level external popup");return null;}}
    catch{return null;}
    return original.call(window,url,target,features);
  };
  document.addEventListener("click",event=>{
    const link=event.target.closest?.("a[target='_blank']");if(!link)return;
    try{if(new URL(link.href,location.href).origin!==location.origin&&!["https://www.youtube.com","https://youtube.com","https://youtu.be"].includes(new URL(link.href,location.href).origin)){event.preventDefault();event.stopImmediatePropagation();}}
    catch{event.preventDefault();event.stopImmediatePropagation();}
  },true);
}
function setupEvents(){
  document.addEventListener("click",event=>{
    const route=event.target.closest("[data-route]")?.dataset.route;if(route){event.preventDefault();showView(route);}
    const close=event.target.closest("[data-close]")?.dataset.close;if(close){closeModal(close==="details"?"detailsModal":close==="player"?"playerModal":"subtitleModal");if(close==="player"){$("embedStage").querySelectorAll("iframe,.player-shield").forEach(x=>x.remove());}}
  });
  $("loadMoreTitles").onclick=()=>{if(state.browseLoading)return;if(!state.browseRetry)state.browsePage++;loadBrowse(false);};
  $("sortSelect").onchange=()=>{state.browsePage=1;loadBrowse(true);};
  $("globalSearch").addEventListener("keydown",e=>{if(e.key==="Enter")runSearch(e.target.value);});
  $("searchButton").onclick=()=>runSearch($("globalSearch").value);
  $("myListButton").onclick=()=>showView("mylist");
  $("channelSearch").oninput=e=>{state.liveSearch=e.target.value;renderChannels();};
  $("liveFullscreen").onclick=()=>{const v=$("liveVideo");if(v.requestFullscreen)v.requestFullscreen();};
  $("playerClickToggle").onclick=()=>setPlayerShield(!$("embedStage").querySelector(".player-shield"));
  document.querySelectorAll("[data-command]").forEach(b=>b.onclick=()=>{const a=b.dataset.command;sendPlayerCommand(a);if(a==="rate+"||a==="rate-"){state.currentRate=Math.max(.25,Math.min(4,state.currentRate+(a==="rate+"?.25:-.25)));$("playbackRate").textContent=state.currentRate.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")+"×";}});
  $("openSubtitles").onclick=openSubtitles;$("subtitleSearchButton").onclick=searchSubtitles;$("applySubtitlePrefs").onclick=applySubtitlePreferences;
  $("detailsModal").addEventListener("click",e=>{if(e.target.id==="detailsModal")closeModal("detailsModal");});
  $("playerModal").addEventListener("click",e=>{if(e.target.id==="playerModal"){closeModal("playerModal");$("embedStage").querySelectorAll("iframe,.player-shield").forEach(x=>x.remove());}});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal("detailsModal");closeModal("subtitleModal");if($("playerModal").classList.contains("open")){closeModal("playerModal");$("embedStage").querySelectorAll("iframe").forEach(x=>x.remove());}}});
  $("seasonSelect").onchange=()=>loadEpisodes(state.current.id,Number($("seasonSelect").value));
}
document.addEventListener("DOMContentLoaded",()=>{
  const more=$("loadMoreTitles");
  if("IntersectionObserver" in window&&more){
    const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting&&!more.hidden&&!state.browseLoading&&!state.browseRetry){state.browsePage++;loadBrowse(false);}}},{root:null,rootMargin:"700px 0px",threshold:0});
    observer.observe(more);
  }
  $("year").textContent=new Date().getFullYear();setupPopupProtection();setupEvents();home();
  $("liveVideo").addEventListener("playing",()=>$("liveStatus").textContent="Playing live");$("liveVideo").addEventListener("waiting",()=>$("liveStatus").textContent="Buffering live stream…");$("liveVideo").addEventListener("error",()=>$("liveStatus").textContent="Stream could not be played. Try another channel.");
});
