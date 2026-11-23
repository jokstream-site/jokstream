const providerInflight = new Map();
const upstreamCookieMemory=new Map();
const upstreamCookieInflight=new Map();
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,HEAD,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Range,Accept,Origin,User-Agent","Access-Control-Expose-Headers":"Content-Length,Content-Range,Accept-Ranges,Content-Type,ETag,Last-Modified","Cache-Control":"no-store"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
function config(env){
  const raw=String(env.XIRO_M3U_URL||env.PROVIDER_URL||env.XTREAM_BASE_URL||"").trim();
  if(!raw)throw new Error("Provider URL secret is missing");
  let source=raw,username=String(env.PROVIDER_USERNAME||env.XTREAM_USERNAME||"").trim(),password=String(env.PROVIDER_PASSWORD||env.XTREAM_PASSWORD||"").trim();
  if(source.includes("|")){
    const parts=source.split("|").map(v=>v.trim());
    if(parts.length>=3){source=parts[0];username=username||parts[1];password=password||parts[2];}
  }
  let u;
  try{u=new URL(source);}catch{throw new Error("Provider URL is invalid");}
  if(u.protocol!=="https:"&&u.protocol!=="http:")throw new Error("Provider URL must use HTTP or HTTPS");
  username=username||String(u.searchParams.get("username")||"").trim();
  password=password||String(u.searchParams.get("password")||"").trim();
  const directM3U=/\.m3u8?$/i.test(u.pathname)||/\/get\.php$/i.test(u.pathname)||(!username&&!password&&u.pathname!=="/"&&!/\/player_api\.php$/i.test(u.pathname));
  if((!username||!password)&&!directM3U)throw new Error("Provider credentials are missing. Use an Xtream URL with username/password, or provide a direct M3U playlist URL.");
  return{origin:u.origin,username,password,secret:raw,mode:directM3U?"m3u":"xtream",playlistUrl:directM3U?u.toString():null};
}
function apiUrl(c,action,params={}){const u=new URL("/player_api.php",c.origin);if(action)u.searchParams.set("action",action);u.searchParams.set("username",c.username);u.searchParams.set("password",c.password);for(const[k,v]of Object.entries(params))if(v!==undefined&&v!==null&&v!=="")u.searchParams.set(k,String(v));return u;}
async function upstreamFetch(target,options={},env=null){
  let url=target instanceof URL?new URL(target):new URL(target);
  const providerConfig=options.__providerConfig||null;
  const providerOrigin=providerConfig?new URL(providerConfig.origin):null;
  const cookieKeyBase=()=>"jokstream:upstream-cookie:"+url.origin+":user:"+encodeURIComponent(providerConfig?.username||"default");
  let jarKey=cookieKeyBase(),jar=upstreamCookieMemory.get(jarKey);
  if(!jar&&env&&env.CACHE){
    let pending=upstreamCookieInflight.get(jarKey);
    if(!pending){pending=env.CACHE.get(jarKey,{type:"json"}).catch(()=>null).finally(()=>upstreamCookieInflight.delete(jarKey));upstreamCookieInflight.set(jarKey,pending);}
    jar=await pending||{};upstreamCookieMemory.set(jarKey,jar);
  }
  jar=jar||{};
  const baseHeaders=new Headers(options.headers||{});
  if(!options.__exactHeaders){
    if(!baseHeaders.has("User-Agent"))baseHeaders.set("User-Agent","Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36");
    if(!baseHeaders.has("Accept"))baseHeaders.set("Accept","*/*");
    if(!baseHeaders.has("Accept-Language"))baseHeaders.set("Accept-Language","en-US,en;q=0.9");
  }
  // The upstream IPTV player does not send browser Origin/Referer headers.
  // Do not add synthetic browser headers to the provider request.
  let response;
  for(let hop=0;hop<7;hop++){
    const headers=new Headers(baseHeaders);
    if(!headers.has("Cookie")&&Object.keys(jar).length)headers.set("Cookie",Object.entries(jar).map(([k,v])=>k+"="+v.value).join("; ")); 
    const fetchOptions={...options,headers,redirect:"manual"};delete fetchOptions.__providerConfig;
    response=await fetch(url,fetchOptions);
    if(response.status===401&&Object.keys(jar).length){
      upstreamCookieMemory.delete(jarKey);if(env&&env.CACHE)env.CACHE.delete(jarKey).catch(()=>{});
      jar={};const retryHeaders=new Headers(baseHeaders);response=await fetch(url,{...fetchOptions,headers:retryHeaders,redirect:"manual"});
    }
    let list=[];try{if(typeof response.headers.getSetCookie==="function")list=response.headers.getSetCookie();else if(typeof response.headers.getAll==="function")list=response.headers.getAll("Set-Cookie");}catch{}
    if(!list.length){const one=response.headers.get("set-cookie");if(one)list=[one];}
    if(list.length){
      const nextJar={...jar};
      for(const line of list){
        const first=String(line).split(";")[0],eq=first.indexOf("=");if(eq<=0)continue;
        const name=first.slice(0,eq).trim(),value=first.slice(eq+1).trim();
        const attrs=String(line).split(";").slice(1).map(x=>x.trim().toLowerCase());
        const age=attrs.find(x=>x.startsWith("max-age=")),expires=attrs.find(x=>x.startsWith("expires="));
        if(!value||(age&&Number(age.slice(8))<=0)||(expires&&Date.parse(expires.slice(8))<Date.now()))delete nextJar[name];else nextJar[name]={value,updated:Date.now()};
      }
      jar=nextJar;jarKey=cookieKeyBase();upstreamCookieMemory.set(jarKey,jar);if(env&&env.CACHE)env.CACHE.put(jarKey,JSON.stringify(jar),{expirationTtl:3600}).catch(()=>{});
    }
    if(![301,302,303,307,308].includes(response.status))return response;
    const location=response.headers.get("location");if(!location)return response;
    let nextUrl=new URL(location,url);
    url=nextUrl;
    jarKey=cookieKeyBase();
    if(!upstreamCookieMemory.has(jarKey)&&env&&env.CACHE){const cached=await env.CACHE.get(jarKey,{type:"json"}).catch(()=>null);if(cached){jar=cached;upstreamCookieMemory.set(jarKey,cached);}}
  }
  return response;
}
async function providerFetch(target,request,env,providerConfig=null,streaming=false){const h=new Headers();const path=String(target?.pathname||"");const directStream=/\/live\/|\/movie\/|\/series\/|\/live\/play\//i.test(path);for(const k of["Accept","If-Range","Icy-MetaData"])if(request.headers.has(k))h.set(k,request.headers.get(k));if(!directStream&&request.headers.has("Range"))h.set("Range",request.headers.get("Range"));if(directStream&&request.headers.has("Range"))h.set("Range",request.headers.get("Range"));h.set("User-Agent",directStream?"Smarters IPTV Pro":(request.headers.get("User-Agent")||"JokStream/1.0"));if(directStream&&!h.has("Accept-Encoding"))h.set("Accept-Encoding","gzip, deflate");const opts={method:request.method==="HEAD"?"HEAD":"GET",headers:h,__providerConfig:providerConfig};if(!streaming)opts.signal=AbortSignal.timeout(30000);return upstreamFetch(target,opts,env);}
async function probePlaylist(target,c,env){
  const r=await upstreamFetch(target,{method:"GET",headers:{"Range":"bytes=0-8191","Accept":"*/*","User-Agent":"JokStream/1.0"},signal:AbortSignal.timeout(20000),__providerConfig:c},env);
  const status=r.status,contentType=r.headers.get("content-type")||"";
  let sample="",bytes=0;const reader=r.body?.getReader();
  if(reader){while(bytes<8192){const part=await reader.read();if(part.done)break;if(part.value){const take=part.value.subarray(0,Math.max(0,8192-bytes));sample+=new TextDecoder().decode(take);bytes+=take.byteLength;}if(bytes>=8192)break;}await reader.cancel().catch(()=>{});}
  return{status,contentType,bytes,detected:/^\s*#EXTM3U/i.test(sample)};
}
async function testProvider(c,env){
  const protocol=c.origin.startsWith("https:")?"https":"http",checks=[];
  if(c.mode==="m3u"&&c.playlistUrl){
    try{const p=await probePlaylist(new URL(c.playlistUrl),c,env);checks.push({test:"direct_m3u",http_status:p.status,content_type:p.contentType,bytes_read:p.bytes,playlist_detected:p.detected});return{connected:p.detected,provider_type:"m3u",protocol,playlist_detected:p.detected,checks,message:p.detected?"Direct M3U playlist fetched successfully":"URL responded but did not return an M3U playlist"};}
    catch(e){checks.push({test:"direct_m3u",error:String(e?.message||e).slice(0,180)});return{connected:false,provider_type:"m3u",protocol,playlist_detected:false,checks,message:"Could not fetch the direct M3U playlist"};}
  }
  const summarize=(data)=>{
    if(Array.isArray(data))return{response_type:"array",item_count:data.length};
    if(data&&typeof data==="object"){
      const ui=data.user_info&&typeof data.user_info==="object"?data.user_info:{};
      const si=data.server_info&&typeof data.server_info==="object"?data.server_info:{};
      let serverHost=null;try{const candidate=si.url||si.server_url||si.host;if(candidate)serverHost=new URL(String(candidate).includes("://")?String(candidate):"http://"+String(candidate)).hostname;}catch{}
      return{response_type:"object",top_level_keys:Object.keys(data).slice(0,30),user_auth:ui.auth??null,user_status:ui.status??null,server_info_keys:Object.keys(si).slice(0,20),server_host:serverHost};
    }
    return{response_type:typeof data};
  };
  const probes=[
    {test:"xtream_login",action:null,params:{}},
    {test:"live_categories",action:"get_live_categories",params:{}},
    {test:"vod_categories",action:"get_vod_categories",params:{}},
    {test:"live_streams",action:"get_live_streams",params:{}},
    {test:"short_epg",action:"get_short_epg",params:{stream_id:"1545807",limit:"4"}}
  ];
  const results=await Promise.all(probes.map(async p=>{
    try{const data=await providerJson(c,p.action,p.params,env);const info=summarize(data);const valid=p.test==="xtream_login"?(data&&typeof data==="object"&&(!data.user_info||data.user_info.auth!==0)):Array.isArray(data);return{test:p.test,success:!!valid,...info};}
    catch(e){return{test:p.test,success:false,error:String(e?.message||e).replace(/([?&]password=)[^&\s]+/ig,"$1[redacted]").slice(0,200)};}
  }));
  checks.push(...results);
  const successes=results.filter(x=>x.success);
  const login=results.find(x=>x.test==="xtream_login");
  const connected=successes.length>0;
  return{connected,provider_type:connected?"xtream":"unknown",protocol,api_success:connected,playlist_detected:false,checks,message:login?.success?"Xtream login and provider API were reached":connected?"At least one Xtream API endpoint responded successfully":"All tested Xtream API endpoints failed"};
}
async function providerJson(c,action,params={},env=null){
 if(c.mode==="m3u"){
  if(action==="get_live_categories"||action==="get_live_streams"){
   const entries=(await getLiveM3uEntries(c,env)).filter(x=>!isLikelyVodM3uEntry(x));
   const groups=[...new Set(entries.map(x=>x.groupTitle||"Uncategorized"))];
   if(action==="get_live_categories")return groups.map((name,i)=>({category_id:String(i+1),category_name:name,parent_id:0}));
   return entries.map((x,i)=>({num:i+1,name:x.title,stream_type:"live",stream_id:String(i+1),stream_icon:x.logo||"",epg_channel_id:x.tvgId||"",category_id:String(groups.indexOf(x.groupTitle||"Uncategorized")+1),category_name:x.groupTitle||"Uncategorized"}));
  }
  if(["get_vod_categories","get_series_categories","get_vod_streams","get_series","get_vod_info","get_series_info","get_short_epg"].includes(action))return [];
  throw new Error("Unsupported M3U action");
 }
 const headers={"User-Agent":"okhttp/5.0.0-alpha.2","Accept-Encoding":"gzip"},target=apiUrl(c,action,params);let relay=null;
 if(env&&env.HOME_RELAY_URL&&env.HOME_RELAY_TOKEN){try{const u=new URL(String(env.HOME_RELAY_URL).trim());if(u.protocol==="https:"||u.protocol==="http:")relay=u;}catch{}}
 let response;if(relay){relay.pathname=relay.pathname.replace(/\/$/,"")+"/relay/player_api.php";relay.search=target.search;response=await fetch(relay.toString(),{headers:{"Authorization":"Bearer "+env.HOME_RELAY_TOKEN,"Accept":"application/json","User-Agent":"JokStream-Worker/1.0"},signal:AbortSignal.timeout(30000)});}else response=await upstreamFetch(target,{headers,__exactHeaders:true,__providerConfig:c,signal:AbortSignal.timeout(30000)},env);
 if(!response.ok)throw new Error("Provider API HTTP "+response.status);const data=await response.json();if(data&&data.user_info&&data.user_info.auth===0)throw new Error("Provider authentication failed");return data;
}
function subtitleConfig(env){const key=env.OPENSUBTITLES_API_KEY;if(!key)throw new Error("OpenSubtitles API key is not configured");return{key,base:"https://api.opensubtitles.com/api/v1"};}
function subtitleHeaders(key){return{"Api-Key":key,"Accept":"application/json","User-Agent":"JokStream v1.0"};}
async function subtitleSearch(url,env){const cfg=subtitleConfig(env);const q=new URLSearchParams();for(const key of ["imdb_id","parent_imdb_id","season_number","episode_number","type","query","languages","year"]){const value=url.searchParams.get(key);if(value)q.set(key,value.toLowerCase());}q.set("page","1");const r=await fetch(cfg.base+"/subtitles?"+q.toString(),{headers:subtitleHeaders(cfg.key),signal:AbortSignal.timeout(15000)});const text=await r.text();if(!r.ok)return json({ok:false,error:"OpenSubtitles HTTP "+r.status},r.status);let data;try{data=JSON.parse(text)}catch{return json({ok:false,error:"Invalid OpenSubtitles JSON"},502)}const items=Array.isArray(data.data)?data.data.map(x=>{const at=x.attributes||x;const fs=Array.isArray(at.files)?at.files:[];return{id:at.subtitle_id||at.id||x.id||"",language:at.language||"",release:at.release||at.feature_details?.title||"",hearing_impaired:!!at.hearing_impaired,download_count:Number(at.download_count||0),fps:Number(at.fps||0),files:fs.slice(0,4).map(f=>({file_id:Number(f.file_id||0),file_name:f.file_name||""})).filter(f=>f.file_id)};}):[];return json({ok:true,total:Number(data.total_count||items.length),items});}
function srtToVtt(text){let s=String(text||"").replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim();if(/^WEBVTT/i.test(s))return s+"\n";s=s.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g,"$1.$2");return"WEBVTT\n\n"+s+"\n";}
async function subtitleDownload(url,env){const cfg=subtitleConfig(env);const fileId=Number(url.searchParams.get("file_id")||0);if(!fileId)return json({ok:false,error:"file_id is required"},400);const r=await fetch(cfg.base+"/download",{method:"POST",headers:{...subtitleHeaders(cfg.key),"Content-Type":"application/json"},body:JSON.stringify({file_id:fileId,sub_format:"webvtt"}),signal:AbortSignal.timeout(15000)});const text=await r.text();if(!r.ok)return json({ok:false,error:"OpenSubtitles download HTTP "+r.status},r.status);let data;try{data=JSON.parse(text)}catch{return json({ok:false,error:"Invalid download response"},502)}if(!data.link)return json({ok:false,error:"Subtitle link unavailable"},502);const file=await fetch(data.link,{signal:AbortSignal.timeout(20000)});if(!file.ok)return json({ok:false,error:"Subtitle file HTTP "+file.status},502);return new Response(srtToVtt(await file.text()),{headers:{...cors,"Content-Type":"text/vtt; charset=utf-8","Cache-Control":"private, max-age=1800"}});}
function safeId(v){return String(v??"").replace(/[^a-zA-Z0-9_-]/g,"");}
function sanitizeProviderData(value){if(Array.isArray(value))return value.map(sanitizeProviderData);if(!value||typeof value!=="object")return value;const blocked=new Set(["direct_source","source_url","stream_url","username","password","auth_token","access_token","api_key","authorization","cookie","headers"]);const clean={};for(const[k,v]of Object.entries(value)){if(blocked.has(k.toLowerCase()))continue;clean[k]=sanitizeProviderData(v);}return clean;}
function normalizeSearch(value){return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/&/g," and ").replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");}
function editDistanceAtMostOne(a,b){if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}if(i<a.length||j<b.length)edits++;return edits<=1;}
function searchFields(row){return [row.name,row.title,row.stream_name,row.stream_display_name,row.channel_name,row.movie_name,row.series_name,row.tvg_name].filter(Boolean).map(normalizeSearch).filter(Boolean);}
function searchScore(row,query){const q=normalizeSearch(query);if(!q)return 0;const wanted=q.split(" ").filter(Boolean);let best=0;for(const field of searchFields(row)){if(field===q)return 100;if(field.startsWith(q))best=Math.max(best,96);else if(field.includes(q))best=Math.max(best,92);const tokens=field.split(" ").filter(Boolean);if(wanted.length>1){const matched=wanted.filter(w=>tokens.some(t=>t===w||t.startsWith(w)||w.startsWith(t))).length;if(matched===wanted.length)best=Math.max(best,86);continue;}const w=wanted[0];if(!w)continue;if(tokens.some(t=>t===w))best=Math.max(best,88);else if(tokens.some(t=>t.startsWith(w)||w.startsWith(t)))best=Math.max(best,78);else if(w.length>=4&&tokens.some(t=>editDistanceAtMostOne(t,w)))best=Math.max(best,62);}return best;}
function searchMatches(row,query){return searchScore(row,query)>0;}
function dateScore(row){for(const key of ["added","last_modified","release_date","releasedate","releaseDate","year"]){const value=row?.[key];if(value===undefined||value===null||value==="")continue;const n=Number(value);if(Number.isFinite(n)&&n>1000000000)return n;if(Number.isFinite(n)&&n>=1888&&n<=2200)return n*31536000;const parsed=Date.parse(String(value));if(Number.isFinite(parsed))return parsed/1000;}return 0;}
function pagination(url,rows){const page=Math.max(1,Number(url.searchParams.get("page")||1)),limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit")||50))),q=String(url.searchParams.get("q")||"").trim(),categoryId=String(url.searchParams.get("category_id")||"").trim(),sort=url.searchParams.get("sort")||"";let filtered=rows;if(categoryId)filtered=filtered.filter(x=>String(x.category_id??x.categoryId??"")===categoryId);if(q){filtered=filtered.map(x=>({row:x,score:searchScore(x,q)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.row);}if(sort==="recent")filtered=filtered.slice().sort((a,b)=>dateScore(b)-dateScore(a));const start=(page-1)*limit,items=filtered.slice(start,start+limit);return{page,limit,total:filtered.length,has_more:start+items.length<filtered.length,items};}
async function cachedProviderJson(env,c,action,params={},ttl=300,ctx=null){const suffix=Object.keys(params).sort().map(k=>k+"="+String(params[k])).join("&"),key="jokstream:v2:"+action+":"+suffix,staleKey=key+":stale";let fresh=null,stale=null;if(env.CACHE){try{fresh=await env.CACHE.get(key,{type:"json"});if(fresh!==null&&fresh!==undefined)return fresh;}catch{}try{stale=await env.CACHE.get(staleKey,{type:"json"});}catch{}if(stale===null||stale===undefined){try{const legacy=await env.CACHE.get("jokstream:v1:"+action+":"+suffix,{type:"json"});if(legacy!==null&&legacy!==undefined){stale=legacy;const body=JSON.stringify(legacy);if(body.length<=20*1024*1024){await env.CACHE.put(key,body,{expirationTtl:ttl});await env.CACHE.put(staleKey,body,{expirationTtl:21600});}}}catch{}}}const refresh=()=>{if(providerInflight.has(key))return providerInflight.get(key);const job=(async()=>{const data=await providerJson(c,action,params,env);if(env.CACHE){try{const body=JSON.stringify(data);if(new TextEncoder().encode(body).byteLength<=20*1024*1024){await env.CACHE.put(key,body,{expirationTtl:ttl});await env.CACHE.put(staleKey,body,{expirationTtl:21600});}}catch{}}return data;})().finally(()=>providerInflight.delete(key));providerInflight.set(key,job);return job;};if(stale!==null&&stale!==undefined){const job=refresh().catch(()=>{});if(ctx&&typeof ctx.waitUntil==="function")ctx.waitUntil(job);return stale;}return refresh();}

async function resilientLiveData(env,c,action,ttl,ctx=null){const data=await cachedProviderJson(env,c,action,{},ttl,ctx);return{data,stale:false,error:null};}

async function handleApi(url,c,env,ctx){const action=url.searchParams.get("action"),allowed=new Set(["get_live_categories","get_vod_categories","get_series_categories","get_live_streams","get_vod_streams","get_series","get_vod_info","get_series_info","get_short_epg"]);if(!allowed.has(action))return json({ok:false,error:"Unsupported or missing action"},400);const params={};if(action==="get_vod_info"){params.vod_id=safeId(url.searchParams.get("vod_id"));if(!params.vod_id)return json({ok:false,error:"vod_id is required"},400);}if(action==="get_series_info"){params.series_id=safeId(url.searchParams.get("series_id"));if(!params.series_id)return json({ok:false,error:"series_id is required"},400);}if(action==="get_short_epg"){params.stream_id=safeId(url.searchParams.get("stream_id"));params.limit=Math.min(10,Math.max(1,Number(url.searchParams.get("limit")||4)));if(!params.stream_id)return json({ok:false,error:"stream_id is required"},400);}const ttl=action.endsWith("_categories")?1800:action==="get_short_epg"?45:action.endsWith("_info")?900:120;const data=await cachedProviderJson(env,c,action,params,ttl,ctx);if(Array.isArray(data))return json({ok:true,action,...pagination(url,sanitizeProviderData(data))});return json({ok:true,action,data:sanitizeProviderData(data)});}
async function catalog(url,c,env,ctx){const kind=url.searchParams.get("kind")||"live";if(kind==="all"){const[liveResult,moviesResult,seriesResult]=await Promise.allSettled([resilientLiveData(env,c,"get_live_streams",120,ctx),cachedProviderJson(env,c,"get_vod_streams",{},600,ctx),cachedProviderJson(env,c,"get_series",{},600,ctx)]);const live=liveResult.status==="fulfilled"&&Array.isArray(liveResult.value.data)?liveResult.value.data:[];const movies=moviesResult.status==="fulfilled"&&Array.isArray(moviesResult.value)?moviesResult.value:[];const series=seriesResult.status==="fulfilled"&&Array.isArray(seriesResult.value)?seriesResult.value:[];if(!live.length&&!movies.length&&!series.length)return json({ok:false,error:"The provider catalog is temporarily unavailable.",partial:false},502);const rows=[...movies.map(x=>({...x,__jok_kind:"movies"})),...series.map(x=>({...x,__jok_kind:"series"})),...live.map(x=>({...x,__jok_kind:"live"}))];const warnings=[];if(liveResult.status!=="fulfilled")warnings.push("Live channels are temporarily unavailable in global search.");else if(liveResult.value.stale)warnings.push("Global search is using the last cached live-channel list.");if(moviesResult.status!=="fulfilled")warnings.push("Movies are temporarily unavailable in global search.");if(seriesResult.status!=="fulfilled")warnings.push("Series are temporarily unavailable in global search.");return json({ok:true,kind,...pagination(url,sanitizeProviderData(rows)),categories:[],warnings,partial:warnings.length>0});}const map={live:["get_live_streams","get_live_categories"],movies:["get_vod_streams","get_vod_categories"],series:["get_series","get_series_categories"],channels:["get_live_streams","get_live_categories"]};if(!map[kind])return json({ok:false,error:"kind must be all, live, movies, series, or channels"},400);if(kind==="live"||kind==="channels"){const[itemsResult,catsResult]=await Promise.allSettled([resilientLiveData(env,c,map[kind][0],120,ctx),resilientLiveData(env,c,map[kind][1],1800)]);const categories=catsResult.status==="fulfilled"&&Array.isArray(catsResult.value.data)?sanitizeProviderData(catsResult.value.data):[];if(itemsResult.status!=="fulfilled"){const reason=itemsResult.reason;return json({ok:false,error:"Live channel list unavailable: "+(reason instanceof Error?reason.message:"Provider request failed"),categories,partial:categories.length>0},502);}const liveData=itemsResult.value;if(!Array.isArray(liveData.data))return json({ok:false,error:"Provider returned an unexpected live-channel response.",categories},502);const page=pagination(url,sanitizeProviderData(liveData.data));const warnings=[];if(catsResult.status!=="fulfilled")warnings.push("Categories are temporarily unavailable; showing channels without category filters.");if(liveData.stale)warnings.push("Showing the last available channel list while the provider recovers.");if(catsResult.status==="fulfilled"&&catsResult.value.stale)warnings.push("Showing cached categories while the provider recovers.");return json({ok:true,kind,...page,categories,stale:liveData.stale||Boolean(catsResult.status==="fulfilled"&&catsResult.value.stale),warnings});}const[itemsResult,catsResult]=await Promise.allSettled([cachedProviderJson(env,c,map[kind][0],{},600,ctx),cachedProviderJson(env,c,map[kind][1],{},1800,ctx)]);if(itemsResult.status!=="fulfilled")return json({ok:false,error:kind+" catalog unavailable: "+(itemsResult.reason instanceof Error?itemsResult.reason.message:"Provider request failed")},502);const items=Array.isArray(itemsResult.value)?itemsResult.value:[];const categories=catsResult.status==="fulfilled"&&Array.isArray(catsResult.value)?sanitizeProviderData(catsResult.value):[];const warnings=catsResult.status==="rejected"?["Categories are temporarily unavailable."]:[];return json({ok:true,kind,...pagination(url,sanitizeProviderData(items)),categories,warnings});}
function bytesToB64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function b64ToBytes(value){const s=value.replace(/-/g,"+").replace(/_/g,"/"),padded=s+"=".repeat((4-s.length%4)%4),raw=atob(padded),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
async function hlsKey(secret){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);}
async function sealUrl(target,secret){const key=await hlsKey(secret),iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(target)),joined=new Uint8Array(iv.length+encrypted.byteLength);joined.set(iv);joined.set(new Uint8Array(encrypted),iv.length);return bytesToB64(joined);}
async function openUrl(token,secret){const all=b64ToBytes(token);if(all.length<29)throw new Error("Invalid HLS resource token");const key=await hlsKey(secret),iv=all.slice(0,12),ciphertext=all.slice(12),plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,ciphertext),target=new URL(new TextDecoder().decode(plain));if(target.protocol!=="https:"&&target.protocol!=="http:")throw new Error("Unsupported HLS resource protocol");return target;}
function workerResourceUrl(requestUrl,token){return new URL("/hls/"+token,requestUrl).toString();}
function resolvePlaylistUri(value,baseUrl){const raw=String(value||'').trim();const base=new URL(baseUrl);const resolved=raw.startsWith('//')?new URL(base.protocol+raw):new URL(raw,base);if(resolved.protocol!=='http:'&&resolved.protocol!=='https:')throw new Error('Unsupported HLS URI protocol');return resolved;}
async function rewritePlaylist(text,baseUrl,requestUrl,secret){const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),out=[];for(const line of lines){const trimmed=line.trim();if(!trimmed){out.push(line);continue;}if(trimmed.startsWith('#')){const attrPattern=/(\bURI\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^,\s]+))/gi;const matches=[...line.matchAll(attrPattern)];let rewritten=line;for(const match of matches){const raw=match[2]??match[3]??match[4];try{const resolved=resolvePlaylistUri(raw,baseUrl);const token=await sealUrl(resolved.toString(),secret);const quote=match[2]!==undefined?'"':match[3]!==undefined?"'":'';rewritten=rewritten.replace(match[0],match[1]+quote+workerResourceUrl(requestUrl,token)+quote);}catch{}}out.push(rewritten);}else{try{const resolved=resolvePlaylistUri(trimmed,baseUrl);const token=await sealUrl(resolved.toString(),secret);const leading=line.match(/^\s*/)?.[0]||'',trailing=line.match(/\s*$/)?.[0]||'';out.push(leading+workerResourceUrl(requestUrl,token)+trailing);}catch{out.push(line);}}}return out.join("\n");}
function withCors(upstream,contentType){const h=new Headers(upstream.headers);for(const[k,v]of Object.entries(cors))h.set(k,v);if(contentType)h.set("Content-Type",contentType);h.delete("Content-Disposition");h.delete("Content-Encoding");h.delete("Content-Length");h.delete("Location");h.delete("Refresh");return h;}
async function proxyHlsResource(request,requestUrl,c,target,env){const r=await providerFetch(target,request,env,c,true);if(!r.ok){const headers=withCors(r);headers.set("X-JokStream-Upstream-Status",String(r.status));headers.set("X-JokStream-Proxy-Result","upstream-error");try{const fu=new URL(r.url||target.toString());headers.set("X-JokStream-Upstream-Final-Host",fu.hostname);headers.set("X-JokStream-Upstream-Final-Port",fu.port||((fu.protocol==="https:")?"443":"80"));headers.set("X-JokStream-Upstream-Redirected",String((r.url||"")!==target.toString()));}catch{}if(!headers.get("Content-Type"))headers.set("Content-Type","video/mp2t");return new Response(r.body,{status:r.status,statusText:r.statusText,headers});}const type=(r.headers.get("content-type")||"").toLowerCase(),isPlaylist=target.pathname.toLowerCase().endsWith(".m3u8")||type.includes("mpegurl")||type.includes("vnd.apple.mpegurl");if(isPlaylist&&request.method!=="HEAD"){const body=await r.text();if(body.trimStart().startsWith("#EXTM3U")){const rewritten=await rewritePlaylist(body,r.url||target,requestUrl,c.secret);const headers=withCors(r,"application/vnd.apple.mpegurl; charset=utf-8");headers.set("Cache-Control","no-store, no-cache, must-revalidate");headers.delete("Content-Length");headers.delete("ETag");return new Response(rewritten,{status:r.status,headers});}return new Response(body,{status:r.status,headers:withCors(r)});}const headers=new Headers(r.headers);for(const[k,v]of Object.entries(cors))headers.set(k,v);headers.set("Cache-Control","no-store, no-transform");headers.set("X-Content-Type-Options","nosniff");headers.set("X-JokStream-Stream-Mode","passthrough");return new Response(r.body,{status:r.status,statusText:r.statusText,headers});}

function normM3uName(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/&/g," and ").replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");}
function parseM3uEntries(text){
 const lines=String(text||"").replace(/^\uFEFF/,"").split(/\r?\n/),out=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();if(!line.startsWith("#EXTINF"))continue;
  const comma=line.indexOf(","),title=comma>=0?line.slice(comma+1).trim():"";
  const attr=(key)=>{const token=key+"=";const p=line.toLowerCase().indexOf(token.toLowerCase());if(p<0)return "";const q=line.indexOf(String.fromCharCode(34),p+token.length);if(q<0)return "";const z=line.indexOf(String.fromCharCode(34),q+1);return z<0?"":line.slice(q+1,z);};
  let url="";for(let j=i+1;j<lines.length;j++){const v=lines[j].trim();if(!v||v.startsWith("#"))continue;url=v;break;}
  if(title&&/^https?:\/\//i.test(url))out.push({title,url,streamId:String(out.length+1),groupTitle:attr("group-title")||"Uncategorized",logo:attr("tvg-logo"),tvgId:attr("tvg-id")});
 }
 return out;
}
function isLikelyVodM3uEntry(entry){
 const path=(()=>{try{return new URL(entry.url).pathname.toLowerCase()}catch{return ""}})();
 const label=String(entry.groupTitle||"")+" "+String(entry.title||"");
 return /\.(mkv|mp4|avi|mov|wmv|m4v|mpg|mpeg)$/i.test(path)||/(movies?|films?|vod|series|episodes?|cinema)/i.test(label);
}
async function getLiveM3uEntries(c,env){
 if(!env.DB)throw new Error("Live catalog database is unavailable");
 const ready=await env.DB.prepare("SELECT total FROM jokstream_live_index WHERE id=1 AND status='ready'").first().catch(()=>null);
 if(ready){const q=await env.DB.prepare("SELECT stream_id,title,title AS name,stream_url AS url,group_title AS groupTitle,logo,tvg_id AS tvgId FROM jokstream_live_channels ORDER BY stream_id").all();return q.results||[];}
 if(providerInflight.has("m3u-live-index"))return providerInflight.get("m3u-live-index");
 const job=(async()=>{
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS jokstream_live_channels(stream_id INTEGER PRIMARY KEY,title TEXT NOT NULL,stream_url TEXT NOT NULL,group_title TEXT NOT NULL,logo TEXT,tvg_id TEXT)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS jokstream_live_stage(run_id TEXT NOT NULL,stream_id INTEGER NOT NULL,title TEXT NOT NULL,stream_url TEXT NOT NULL,group_title TEXT NOT NULL,logo TEXT,tvg_id TEXT,PRIMARY KEY(run_id,stream_id))").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS jokstream_live_index(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0,updated_at TEXT)").run();
  const runId=crypto.randomUUID();let target;if(c.mode==="m3u"&&c.playlistUrl)target=new URL(c.playlistUrl);else{target=new URL("/get.php",c.origin);target.searchParams.set("username",c.username);target.searchParams.set("password",c.password);target.searchParams.set("type","m3u_plus");target.searchParams.set("output","m3u8");}
  const response=await upstreamFetch(target,{headers:{"Accept":"audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain","User-Agent":"JokStream/1.0"},signal:AbortSignal.timeout(90000),__providerConfig:c},env);if(!response.ok||!response.body)throw new Error("Provider playlist HTTP "+response.status);
  const reader=response.body.getReader(),decoder=new TextDecoder();let carry="",header="",pending=null,count=0,batch=[];
  const attr=(line,key)=>{const token=key+"=\"";const p=line.toLowerCase().indexOf(token.toLowerCase());if(p<0)return "";const a=p+token.length,z=line.indexOf("\"",a);return z<0?"":line.slice(a,z);};
  const flush=async()=>{if(!batch.length)return;const statements=batch.map(x=>env.DB.prepare("INSERT OR REPLACE INTO jokstream_live_stage(run_id,stream_id,title,stream_url,group_title,logo,tvg_id) VALUES(?,?,?,?,?,?,?)").bind(runId,x.stream_id,x.title,x.url,x.groupTitle,x.logo,x.tvgId));await env.DB.batch(statements);batch=[];};
  const consume=async(line)=>{const v=line.trim();if(!v)return;if(!header){if(v.startsWith("#EXTM3U"))header=v;return;}if(v.startsWith("#EXTINF")){const comma=v.indexOf(",");pending={title:comma>=0?v.slice(comma+1).trim():"",groupTitle:attr(v,"group-title")||"Uncategorized",logo:attr(v,"tvg-logo"),tvgId:attr(v,"tvg-id")};return;}if(v.startsWith("#"))return;if(pending){const e={title:pending.title,url:v,groupTitle:pending.groupTitle,logo:pending.logo,tvgId:pending.tvgId};pending=null;if(e.title&&/^https?:\/\//i.test(e.url)&&!isLikelyVodM3uEntry(e)){count++;batch.push({stream_id:count,...e});if(batch.length>=100)await flush();}}};
  try{while(true){const part=await reader.read();if(part.done)break;carry+=decoder.decode(part.value,{stream:true});let pos;while((pos=carry.indexOf("\n"))>=0){const line=carry.slice(0,pos).replace(/\r$/,"");carry=carry.slice(pos+1);await consume(line);}}carry+=decoder.decode();if(carry)await consume(carry);await flush();}catch(e){await reader.cancel().catch(()=>{});await env.DB.prepare("DELETE FROM jokstream_live_stage WHERE run_id=?").bind(runId).run().catch(()=>{});throw e;}
  if(!header)throw new Error("Provider response is not an M3U playlist");if(!count)throw new Error("No live channels were found in the M3U playlist");
  await env.DB.batch([env.DB.prepare("DELETE FROM jokstream_live_channels"),env.DB.prepare("INSERT INTO jokstream_live_channels(stream_id,title,stream_url,group_title,logo,tvg_id) SELECT stream_id,title,stream_url,group_title,logo,tvg_id FROM jokstream_live_stage WHERE run_id=? ORDER BY stream_id").bind(runId),env.DB.prepare("DELETE FROM jokstream_live_stage WHERE run_id=?").bind(runId),env.DB.prepare("INSERT INTO jokstream_live_index(id,status,total,updated_at) VALUES(1,'ready',?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET status='ready',total=excluded.total,updated_at=CURRENT_TIMESTAMP").bind(count)]);
  return (await env.DB.prepare("SELECT stream_id,title,title AS name,stream_url AS url,group_title AS groupTitle,logo,tvg_id AS tvgId FROM jokstream_live_channels ORDER BY stream_id").all()).results||[];
 })().finally(()=>providerInflight.delete("m3u-live-index"));providerInflight.set("m3u-live-index",job);return job;
}
async function resolveLiveM3uTarget(id,c,env,ctx){
  const cacheKey="jokstream:live-target:"+id;
  if(env.CACHE){try{const cached=await env.CACHE.get(cacheKey,{type:"text"});if(cached)return new URL(cached);}catch{}}
  const rows=await cachedProviderJson(env,c,"get_live_streams",{},120,ctx);
  if(!Array.isArray(rows))throw new Error("Live channel catalog unavailable");
  const row=rows.find(x=>String(x?.stream_id??"")===String(id));
  if(!row)throw new Error("Live channel was not found in provider catalog");
  const wanted=normM3uName(row.name||row.stream_name||row.channel_name);
  const category=normM3uName(row.category_name||"");
  const entries=await getLiveM3uEntries(c,env);
  let match=entries.find(e=>String(e.streamId||"")===String(id));
  if(!match)match=entries.find(e=>normM3uName(e.title)===wanted);
  if(!match&&category)match=entries.find(e=>normM3uName(e.title)===wanted&&normM3uName(e.title).includes(category));
  if(!match){const candidates=entries.filter(e=>{const n=normM3uName(e.title);return wanted&&((n.includes(wanted)&&wanted.length>4)||(wanted.includes(n)&&n.length>4));});match=candidates[0];}
  if(!match)throw new Error("No matching M3U stream URL found for "+String(row.name||id));
  const target=new URL(match.url);
  if(target.protocol!=="http:"&&target.protocol!=="https:")throw new Error("Provider stream URL uses an unsupported protocol");
  if(env.CACHE){try{await env.CACHE.put(cacheKey,target.toString(),{expirationTtl:1800});}catch{}}
  return target;
}
async function stream(request,url,c,env,ctx){
  const p=url.pathname.split("/").filter(Boolean);
  if(p.length!==3)return json({ok:false,error:"Expected /stream/live|movie|series/ID.ext"},400);
  const type=p[1],file=p[2],dot=file.lastIndexOf("."),id=safeId(dot>0?file.slice(0,dot):file),ext=(dot>0?file.slice(dot+1):"mp4").replace(/[^a-z0-9]/gi,"").slice(0,8)||"mp4";
  if(!["live","movie","series"].includes(type)||!id)return json({ok:false,error:"Invalid stream path"},400);
  let upstream;
  if(type==="live"){
    if(c.mode==="m3u"){
      const n=Number(id);if(!Number.isInteger(n)||n<1)return json({ok:false,error:"Invalid M3U channel id"},400);
      const match=await env.DB.prepare("SELECT stream_url FROM jokstream_live_channels WHERE stream_id=?").bind(n).first();
      if(!match?.stream_url)return json({ok:false,error:"M3U channel not found"},404);
      upstream=new URL(match.stream_url);
    }else upstream=new URL("/live/"+encodeURIComponent(c.username)+"/"+encodeURIComponent(c.password)+"/"+id+"."+(ext==="m3u8"?"m3u8":"ts"),c.origin);
  }else{
    const path=type==="movie"?"/movie":"/series";
    upstream=new URL(path+"/"+encodeURIComponent(c.username)+"/"+encodeURIComponent(c.password)+"/"+id+"."+ext,c.origin);
  }
  const r=await providerFetch(upstream,request,env,c,true);
  if(!r.ok){const headers=withCors(r);headers.set("X-JokStream-Upstream-Status",String(r.status));headers.set("X-JokStream-Proxy-Result","upstream-error");try{headers.set("X-JokStream-Upstream-Final-Host",new URL(r.url||upstream).hostname)}catch{};return new Response(r.body,{status:r.status,statusText:r.statusText,headers});}
  return proxyHlsResourceFromResponse(request,url,c,upstream,r,env);
}

async function proxyProviderImage(request,url,c,env){
  const rawTarget=url.searchParams.get("url")||"";
  if(!rawTarget)return json({ok:false,error:"Image URL is required"},400);
  let target;
  try{target=new URL(rawTarget);}catch{return json({ok:false,error:"Invalid image URL"},400);}
  if(target.protocol!=="http:"&&target.protocol!=="https:")return json({ok:false,error:"Unsupported image protocol"},400);
  if(target.origin!==c.origin)return json({ok:false,error:"Image target is not the configured provider"},403);
  const cacheKey=new Request(new URL("/proxy/image?url="+encodeURIComponent(target.toString()),request.url).toString(),{method:"GET"});
  const cache=typeof caches!=="undefined"?caches.default:null;
  if(cache){const hit=await cache.match(cacheKey);if(hit)return hit;}
  const r=await providerFetch(target,request,env,c,false);
  const headers=withCors(r);
  headers.set("Cache-Control","public, max-age=3600, s-maxage=86400");
  headers.set("X-JokStream-Proxy-Result",r.ok?"image-proxy":"image-upstream-error");
  headers.set("X-Content-Type-Options","nosniff");
  const response=new Response(r.body,{status:r.status,statusText:r.statusText,headers});
  if(cache&&r.ok)await cache.put(cacheKey,response.clone());
  return response;
}

async function proxyProviderMpegts(request,url,c,env){
  const p=url.pathname.split("/").filter(Boolean);
  if(p.length!==4||p[0]!=="play"||p[1]!=="mpegts")return json({ok:false,error:"Invalid MPEG-TS playback path"},400);
  const token=p[2],file=p[3];
  if(!token||!/^[A-Za-z0-9._=-]+$/.test(token)||!/^[0-9a-f-]{16,64}\.ts$/i.test(file))return json({ok:false,error:"Invalid playback token or channel id"},400);
  const lv=url.searchParams.get("lvtoken");
  if(!lv||lv.length<16||lv.length>4096)return json({ok:false,error:"Missing playback session token"},400);
  const target=new URL("/play/mpegts/"+token+"/"+file,c.origin); target.searchParams.set("lvtoken",lv);
  const r=await providerFetch(target,request,env,c,true); const headers=new Headers(r.headers);
  for(const[k,v]of Object.entries(cors))headers.set(k,v); headers.set("Cache-Control","no-store, no-cache, must-revalidate"); headers.set("X-JokStream-Stream-Mode","passthrough");
  headers.delete("Content-Length");headers.delete("Content-Disposition");headers.delete("Content-Encoding");headers.delete("Location");headers.delete("Refresh");headers.set("X-Accel-Buffering","no"); if(!headers.get("Content-Type"))headers.set("Content-Type","video/mp2t");
  return new Response(r.body,{status:r.status,statusText:r.statusText,headers});
}

async function proxyHlsResourceFromResponse(request,requestUrl,c,target,r,env){
  if(!r.ok)return proxyHlsResource(request,requestUrl,c,target,env);
  const type=(r.headers.get("content-type")||"").toLowerCase(),isPlaylist=target.pathname.toLowerCase().endsWith(".m3u8")||type.includes("mpegurl")||type.includes("vnd.apple.mpegurl");
  if(isPlaylist&&request.method!=="HEAD"){
    const body=await r.text();
    if(body.trimStart().startsWith("#EXTM3U")){
      const rewritten=await rewritePlaylist(body,r.url||target,requestUrl,c.secret);
      const headers=withCors(r,"application/vnd.apple.mpegurl; charset=utf-8");headers.set("Cache-Control","no-store, no-cache, must-revalidate");headers.delete("Content-Length");headers.delete("ETag");
      return new Response(rewritten,{status:r.status,headers});
    }
    return new Response(body,{status:r.status,headers:withCors(r)});
  }
  const headers=new Headers(r.headers);for(const[k,v]of Object.entries(cors))headers.set(k,v);headers.set("Cache-Control","no-store, no-transform");headers.set("X-Content-Type-Options","nosniff");headers.set("X-JokStream-Stream-Mode","passthrough");
  return new Response(r.body,{status:r.status,statusText:r.statusText,headers});
}


const AUTH_ACCESS_TTL=300;
const AUTH_REFRESH_TTL=30*24*60*60;
function b64u(bytes){let s="";for(const x of bytes)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function b64uText(s){return b64u(new TextEncoder().encode(s));}
function hex(bytes){return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,"0")).join("");}
async function sha256Text(s){return crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));}
async function hmacText(secret,s){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);return new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(s)));}
function randomToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return b64u(b);}
async function signJwt(payload,secret){const h=b64uText(JSON.stringify({alg:"HS256",typ:"JWT"}));const p=b64uText(JSON.stringify(payload));const s=h+"."+p;return s+"."+b64u(await hmacText(secret,s));}
async function verifyJwt(token,secret){try{const parts=token.split(".");if(parts.length!==3)return null;const data=parts[0]+"."+parts[1];const sig=parts[2].replace(/-/g,"+").replace(/_/g,"/");const bin=atob(sig+"=".repeat((4-sig.length%4)%4));const got=Uint8Array.from(bin,c=>c.charCodeAt(0));const expected=await hmacText(secret,data);if(got.length!==expected.length||!crypto.subtle.timingSafeEqual){};let diff=got.length^expected.length;for(let i=0;i<Math.min(got.length,expected.length);i++)diff|=got[i]^expected[i];if(diff!==0)return null;const payload=JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-parts[1].length%4)%4)));const now=Math.floor(Date.now()/1000);if(payload.exp<=now||payload.nbf>now)return null;return payload;}catch{return null;}}
function authJson(env){return !!(env.AUTH_DB&&env.JOKSTREAM_TOKEN_SECRET);}
async function createSession(env,subject,scopes){if(!authJson(env))return json({ok:false,error:"Auth preview is not enabled"},404);const now=Math.floor(Date.now()/1000),sid=randomToken(),family_id=randomToken(),refresh=randomToken(),hash=hex(await sha256Text(refresh)),exp=now+AUTH_REFRESH_TTL;const payload={iss:"jokstream",aud:"jokstream-api",iat:now,nbf:now,exp:now+AUTH_ACCESS_TTL,jti:randomToken(),sub:subject,sid,scopes};await env.AUTH_DB.prepare("INSERT INTO auth_sessions (sid,subject,scopes_json,refresh_hash,family_id,generation,created_at,last_seen_at,refresh_expires_at) VALUES (?,?,?,?,?,0,?,?,?)").bind(sid,subject,JSON.stringify(scopes),hash,family_id,now,now,exp).run();return json({ok:true,token_type:"Bearer",access_token:await signJwt(payload,env.JOKSTREAM_TOKEN_SECRET),expires_in:AUTH_ACCESS_TTL,refresh_token:refresh,refresh_expires_in:AUTH_REFRESH_TTL});}
async function refreshSession(env,refresh){if(!authJson(env))return json({ok:false,error:"Auth preview is not enabled"},404);if(!refresh)return json({ok:false,error:"Missing refresh_token"},400);const hash=hex(await sha256Text(refresh)),now=Math.floor(Date.now()/1000),newRefresh=randomToken(),newHash=hex(await sha256Text(newRefresh)),newSid=randomToken();const row=await env.AUTH_DB.prepare("SELECT sid,subject,scopes_json,family_id,generation,refresh_expires_at,revoked_at FROM auth_sessions WHERE refresh_hash=?").bind(hash).first();if(!row)return json({ok:false,error:"Invalid refresh token"},401);if(row.revoked_at||row.refresh_expires_at<=now){if(!row.revoked_at)await env.AUTH_DB.prepare("UPDATE auth_sessions SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL").bind(now,row.family_id).run();return json({ok:false,error:"Refresh token expired or revoked"},401);}const accessPayload={iss:"jokstream",aud:"jokstream-api",iat:now,nbf:now,exp:now+AUTH_ACCESS_TTL,jti:randomToken(),sub:row.subject,sid:newSid,scopes:JSON.parse(row.scopes_json)};const stmts=[env.AUTH_DB.prepare("UPDATE auth_sessions SET revoked_at=?,replaced_by=?,last_seen_at=? WHERE sid=? AND refresh_hash=? AND revoked_at IS NULL").bind(now,newSid,now,row.sid,hash),env.AUTH_DB.prepare("INSERT INTO auth_sessions (sid,subject,scopes_json,refresh_hash,family_id,generation,created_at,last_seen_at,refresh_expires_at) VALUES (?,?,?,?,?,?,?, ?,?)").bind(newSid,row.subject,row.scopes_json,newHash,row.family_id,row.generation+1,now,now,row.refresh_expires_at)];const results=await env.AUTH_DB.batch(stmts);if(!results[0].meta?.changes)return json({ok:false,error:"Refresh token already used"},401);return json({ok:true,token_type:"Bearer",access_token:await signJwt(accessPayload,env.JOKSTREAM_TOKEN_SECRET),expires_in:AUTH_ACCESS_TTL,refresh_token:newRefresh,refresh_expires_in:Math.max(0,row.refresh_expires_at-now)});}
async function revokeSession(env,token){if(!authJson(env))return json({ok:false,error:"Auth preview is not enabled"},404);const p=await verifyJwt(token,env.JOKSTREAM_TOKEN_SECRET);if(!p?.sid)return json({ok:false,error:"Invalid access token"},401);const now=Math.floor(Date.now()/1000);await env.AUTH_DB.prepare("UPDATE auth_sessions SET revoked_at=? WHERE sid=? AND revoked_at IS NULL").bind(now,p.sid).run();return json({ok:true});}

export default{async fetch(request,env,ctx){if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});if(request.method!=="GET"&&request.method!=="HEAD"&&request.method!=="POST")return json({ok:false,error:"Method not allowed"},405);const url=new URL(request.url);try{if(url.pathname==="/"&&url.searchParams.has("proxy_url")){const target=new URL(url.searchParams.get("proxy_url"));if(target.origin!==c.origin)return json({ok:false,error:"Proxy target is not the configured provider"},403);return await proxyHlsResource(request,url,c,target,env);}if(url.pathname==="/api/auth/session"){if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},405);let body={};try{body=await request.json();}catch{};return await createSession(env,String(body.subject||"preview-user"),Array.isArray(body.scopes)?body.scopes:["stream"]);}if(url.pathname==="/api/auth/refresh"){if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},405);let body={};try{body=await request.json();}catch{};return await refreshSession(env,String(body.refresh_token||""));}if(url.pathname==="/api/auth/revoke"){if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},405);const h=request.headers.get("authorization")||"";return await revokeSession(env,h.startsWith("Bearer ")?h.slice(7):"");}if(url.pathname==="/"||url.pathname==="/health")return json({ok:true,service:"JokStream API",version:"0.4.8",database:env.DB?"connected":"missing",cache:env.CACHE?"connected":"missing",r2:"disabled",providerSecret:!!env.XIRO_M3U_URL,hlsRewrite:true});const c=config(env);
if(url.pathname==="/debug/connection"){
  const parsed=new URL(c.origin);
  const host=parsed.hostname;
  const candidates=[
    {label:"configured_http",url:"http://"+host+"/"},
    {label:"configured_https",url:"https://"+host+"/"},
    {label:"api_http",url:"http://"+host+"/player_api.php"},
    {label:"api_https",url:"https://"+host+"/player_api.php"}
  ];
  const results=await Promise.all(candidates.map(async item=>{
    const started=Date.now();
    try{
      const target=new URL(item.url);
      const response=await fetch(target.toString(),{
        method:"GET",
        headers:{"User-Agent":"JokStream-Diagnostic/1.0","Accept":"*/*"},
        redirect:"manual",
        signal:AbortSignal.timeout(12000)
      });
      return {
        test:item.label,status:response.status,elapsed_ms:Date.now()-started,
        server:response.headers.get("server"),
        content_type:response.headers.get("content-type"),
        location_host:(()=>{const v=response.headers.get("location");if(!v)return null;try{return new URL(v,target).hostname}catch{return null}})(),
        via:response.headers.get("via"),
        cf_ray:response.headers.get("cf-ray")
      };
    }catch(e){
      return {test:item.label,error:String(e?.message||e).slice(0,180),elapsed_ms:Date.now()-started};
    }
  }));
  return json({
    ok:results.some(x=>x.status>=200&&x.status<400),
    diagnostic_only:true,
    configured_protocol:parsed.protocol.replace(":",""),
    configured_host:host,
    note:"Unauthenticated probes only; no credentials or stream tokens were sent.",
    results
  },200);
}

if(url.pathname==="\/debug\/provider"){const target=apiUrl(c,"get_live_categories");const r=await providerJson(c,"get_live_categories",{},env).catch(e=>({__error:String(e?.message||e)}));return json({ok:!r.__error,provider_origin:c.origin,api_path:target.pathname,api_status:r.__error?null:200,error:r.__error||null});}
async function debugLive(request,url,c,env){
  const p=url.pathname.split("/").filter(Boolean),id=safeId(p[2]||"");
  if(p.length!==3||p[0]!=="debug"||p[1]!=="live"||!id)return json({ok:false,error:"Use /debug/live/CHANNEL_ID"},400);
  const target=new URL("/live/"+encodeURIComponent(c.username)+"/"+encodeURIComponent(c.password)+"/"+id+".ts",c.origin);
  const r=await providerFetch(target,request,env,c,true);
  const reader=r.body?.getReader(); let bytes=new Uint8Array(0);
  if(reader){const part=await reader.read();if(part.value)bytes=part.value;await reader.cancel().catch(()=>{});}
  const syncOffsets=[];for(let i=0;i+188<=bytes.length;i+=188){if(bytes[i]===0x47)syncOffsets.push(i);if(syncOffsets.length>=8)break;}
  const streams=[];let pmtPid=null;
  for(let off=0;off+188<=bytes.length;off+=188){if(bytes[off]!==0x47)continue;const pid=((bytes[off+1]&31)<<8)|bytes[off+2],afc=(bytes[off+3]>>4)&3;let pos=off+4;if(afc===2||afc===3){pos+=1+(bytes[pos]||0);}if(pos>=off+188)continue;if(pid===0&&(bytes[off+1]&64)&&bytes[pos]===0){const pointer=bytes[pos+1]||0,s=pos+2+pointer;if(s+8<off+188&&bytes[s]===0){const len=((bytes[s+1]&15)<<8)|bytes[s+2],end=Math.min(s+3+len,off+188);for(let j=s+8;j+3<end;j+=4){const program=(bytes[j]<<8)|bytes[j+1],ppid=((bytes[j+2]&31)<<8)|bytes[j+3];if(program){pmtPid=ppid;break;}}}}}
  const names={1:"MPEG1 video",2:"MPEG2 video",3:"MPEG1 audio",4:"MPEG2 audio",15:"AAC",27:"H.264/AVC",36:"H.265/HEVC",129:"AC-3"};
  if(pmtPid!==null)for(let off=0;off+188<=bytes.length;off+=188){if(bytes[off]!==0x47)continue;const pid=((bytes[off+1]&31)<<8)|bytes[off+2],afc=(bytes[off+3]>>4)&3;let pos=off+4;if(afc===2||afc===3)pos+=1+(bytes[pos]||0);if(pos>=off+188)continue;if(pid===pmtPid&&(bytes[off+1]&64)){const pointer=bytes[pos]||0,s=pos+1+pointer;if(s+12<off+188&&bytes[s]===2){const len=((bytes[s+1]&15)<<8)|bytes[s+2],end=Math.min(s+3+len,off+188),pi=((bytes[s+10]&15)<<8)|bytes[s+11];let j=s+12+pi;while(j+4<=end-4){const st=bytes[j],ep=((bytes[j+1]&31)<<8)|bytes[j+2],eil=((bytes[j+3]&15)<<8)|bytes[j+4];streams.push({stream_type:"0x"+st.toString(16).padStart(2,"0"),codec:names[st]||"unknown",pid:ep});j+=5+eil;}}break;}}
  return json({ok:r.ok,status:r.status,content_type:r.headers.get("content-type"),final_host:r.url?new URL(r.url).hostname:null,bytes_read:bytes.length,sync_offsets:syncOffsets,pmt_pid:pmtPid,streams,first_bytes_hex:Array.from(bytes.slice(0,24),x=>x.toString(16).padStart(2,"0")).join(" ")},r.ok?200:502);
}

if(url.pathname==="/debug/provider"){const result=await testProvider(c,env);return json({ok:result.connected,...result},result.connected?200:502);}if(url.pathname==="/test"||url.pathname==="/test-provider"){const result=await testProvider(c,env);return json({ok:result.connected,...result},result.connected?200:502);}if(url.pathname==="/test-playlist"){const result=await testProvider(c,env);const pc=result.checks?.find(x=>x.test==="direct_m3u"||x.test==="xtream_m3u");return json({ok:!!pc?.playlist_detected,provider_type:result.provider_type,protocol:result.protocol,playlist_detected:!!pc?.playlist_detected,http_status:pc?.http_status??null,content_type:pc?.content_type??null,checks:result.checks||[]},pc?.playlist_detected?200:502);}if(url.pathname==="/api/subtitles")return await subtitleSearch(url,env);if(url.pathname==="/api/subtitles/download")return await subtitleDownload(url,env);if(url.pathname==="/api")return await handleApi(url,c,env,ctx);if(url.pathname==="/api/catalog")return await catalog(url,c,env,ctx);if(url.pathname==="/proxy/image"||url.pathname.startsWith("/proxy/image/"))return await proxyProviderImage(request,url,c,env);if(url.pathname==="/hls/"||url.pathname.startsWith("/hls/")){const token=url.pathname.slice("/hls/".length);if(!token||token.includes("/"))return json({ok:false,error:"Invalid HLS token"},400);const target=await openUrl(token,c.secret);return proxyHlsResource(request,url,c,target,env);}if(url.pathname==="/play/mpegts"||url.pathname.startsWith("/play/mpegts/"))return await proxyProviderMpegts(request,url,c,env);if(url.pathname==="/stream"||url.pathname.startsWith("/stream/"))return await stream(request,url,c,env,ctx);return json({ok:false,error:"Not found"},404);}catch(e){return json({ok:false,error:e instanceof Error?e.message:"Internal error"},502);}}};