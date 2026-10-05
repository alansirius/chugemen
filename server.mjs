import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {extname,resolve} from 'node:path';
import {recommend} from './recommend.mjs';
import {seeds} from './seed.mjs';
mkdirSync('data',{recursive:true});
const db=new DatabaseSync(process.env.DB_PATH||'data/app.sqlite');
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE,password TEXT,bio TEXT DEFAULT '周末很短，世界很大。',interests TEXT DEFAULT '户外自然,城市漫步');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),title TEXT,body TEXT,place TEXT,category TEXT,budget REAL,hours REAL,lat REAL,lon REAL,indoor INTEGER,image TEXT,original_id INTEGER REFERENCES posts(id),demo INTEGER DEFAULT 0,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS likes(user_id INTEGER REFERENCES users(id),post_id INTEGER REFERENCES posts(id),PRIMARY KEY(user_id,post_id));
CREATE TABLE IF NOT EXISTS follows(user_id INTEGER REFERENCES users(id),target_id INTEGER REFERENCES users(id),PRIMARY KEY(user_id,target_id));
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),post_id INTEGER REFERENCES posts(id),body TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY,post_id INTEGER REFERENCES posts(id),user_id INTEGER REFERENCES users(id),date TEXT,capacity INTEGER);
CREATE TABLE IF NOT EXISTS members(group_id INTEGER REFERENCES groups(id),user_id INTEGER REFERENCES users(id),PRIMARY KEY(group_id,user_id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,sender INTEGER REFERENCES users(id),recipient INTEGER REFERENCES users(id),body TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);`);
const all=(sql,...p)=>db.prepare(sql).all(...p), one=(sql,...p)=>db.prepare(sql).get(...p), run=(sql,...p)=>db.prepare(sql).run(...p);
if(!one('SELECT id FROM users LIMIT 1')) {
 ['山野收集员','小岛同学','一颗栗子'].forEach((n,i)=>run('INSERT INTO users(id,name,bio) VALUES(?,?,?)',i+1,n,'示例作者 · 一起发现城市的另一面'));
 seeds.forEach(([title,place,category,budget,hours,lat,lon,indoor,img,body,uid])=>run('INSERT INTO posts(user_id,title,body,place,category,budget,hours,lat,lon,indoor,image,demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)',uid,title,body,place,category,budget,hours,lat,lon,indoor,`https://images.unsplash.com/${img}?auto=format&fit=crop&w=800&q=85`));
}
const publicUser=u=>u&&({id:u.id,name:u.name,bio:u.bio,interests:u.interests});
const postSql=`SELECT p.*,u.name,(SELECT count(*) FROM likes WHERE post_id=p.id) likes,(SELECT count(*) FROM comments WHERE post_id=p.id) comments FROM posts p JOIN users u ON u.id=p.user_id`;
const err=(msg,status=400)=>{throw Object.assign(new Error(msg),{status});};
const str=(v,max=2000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)err('请检查输入内容及长度');return v.trim();};
const num=(v,min,max)=>{const n=Number(v);if(v===undefined||v===''||!Number.isFinite(n)||n<min||n>max)err('数值超出有效范围');return n;};
const categories=['户外自然','城市漫步','咖啡美食','露营野餐','展览艺术','市集探索'];
const weatherCache=new Map();
async function weather(lat,lon){
 const key=`${lat.toFixed(2)},${lon.toFixed(2)}`, old=weatherCache.get(key);if(old&&Date.now()-old.at<600000)return old.value;
 try{const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`,{signal:AbortSignal.timeout(3500)});if(!r.ok)throw Error();const d=await r.json();const value={temperature:d.current.temperature_2m,code:d.current.weather_code,time:d.current.time,source:'Open-Meteo'};weatherCache.set(key,{at:Date.now(),value});return value;}catch{return null;}
}
async function body(req){let s='';for await(const b of req){s+=b;if(s.length>4500000)err('图片或内容过大',413);}try{return JSON.parse(s||'{}');}catch{err('无效的 JSON');}}
const server=createServer(async(req,res)=>{
 const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
 const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
 if(!path.startsWith('/api/')){if(method!=='GET'&&method!=='HEAD')err('不支持的方法',405);const file=path==='/'?'index.html':decodeURIComponent(path.slice(1));const full=resolve('public',file);if(!full.startsWith(resolve('public')+'/'))err('禁止访问',403);try{const data=readFileSync(full);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(full)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(method==='HEAD'?undefined:data);}catch{json({error:'页面不存在'},404);}return;}
 if(!['GET','HEAD'].includes(method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)err('来源不被允许',403);
 const token=(req.headers.cookie||'').match(/(?:^|; )session=([a-f0-9]+)/)?.[1];
 const me=token?one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=? AND expires>?',token,Date.now()):null;
 if(path==='/api/me'&&method==='GET')return json(publicUser(me)||null);
 if(path==='/api/auth'&&method==='POST'){
  const b=await body(req);let u;
  if(b.mode==='demo'){const id=run('INSERT INTO users(name) VALUES(?)','周末体验家').lastInsertRowid;u=one('SELECT * FROM users WHERE id=?',id);}
  else {const username=str(b.username,50),password=str(b.password,128);if(password.length<8)err('密码至少需要 8 位');
   if(b.mode==='register'){if(one('SELECT id FROM users WHERE username=?',username))err('用户名已被使用');const salt=randomBytes(16).toString('hex');const hash=scryptSync(password,salt,64).toString('hex');const id=run('INSERT INTO users(name,username,password) VALUES(?,?,?)',str(b.name,30),username,`${salt}:${hash}`).lastInsertRowid;u=one('SELECT * FROM users WHERE id=?',id);}
   else {u=one('SELECT * FROM users WHERE username=?',username);if(!u?.password)err('帐号或密码不正确',401);const [salt,hash]=u.password.split(':');if(!timingSafeEqual(scryptSync(password,salt,64),Buffer.from(hash,'hex')))err('帐号或密码不正确',401);}}
  const t=randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?)',t,u.id,Date.now()+7*86400000);res.setHeader('Set-Cookie',`session=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return json(publicUser(u));
 }
 if(path==='/api/logout'&&method==='POST'){if(token)run('DELETE FROM sessions WHERE token=?',token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return json({ok:true});}
 if(path==='/api/weather'&&method==='GET')return json(await weather(num(url.searchParams.get('lat'),-90,90),num(url.searchParams.get('lon'),-180,180)));
 if(path==='/api/posts'&&method==='GET'){
  const opts=Object.fromEntries(url.searchParams);for(const [k,min,max] of [['lat',-90,90],['lon',-180,180],['budget',0,100000],['hours',0,168],['radius',0,20050]])if(k in opts)opts[k]=num(opts[k],min,max);
  if(opts.weather==='wet')opts.weather={code:61};else if(opts.weather==='dry')opts.weather={code:0};else opts.weather=null;
  opts.interests=me?.interests||opts.interests||'';let rows=all(postSql);
  if(opts.user)rows=rows.filter(p=>p.user_id===+opts.user);
  if(opts.following==='1')rows=rows.filter(p=>me&&one('SELECT 1 FROM follows WHERE user_id=? AND target_id=?',me.id,p.user_id));
  return json(recommend(rows,opts));
 }
 let m=path.match(/^\/api\/posts\/(\d+)$/);
 if(m&&method==='GET'){const p=one(postSql+' WHERE p.id=?',+m[1]);if(!p)err('帖子不存在',404);p.liked=!!(me&&one('SELECT 1 FROM likes WHERE user_id=? AND post_id=?',me.id,p.id));p.commentList=all('SELECT c.*,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE post_id=? ORDER BY c.id',p.id);p.groups=all('SELECT g.*,u.name,(SELECT count(*) FROM members WHERE group_id=g.id) count FROM groups g JOIN users u ON u.id=g.user_id WHERE post_id=?',p.id).map(g=>({...g,joined:!!(me&&one('SELECT 1 FROM members WHERE group_id=? AND user_id=?',g.id,me.id))}));return json(p);}
 m=path.match(/^\/api\/users\/(\d+)$/);
 if(m&&method==='GET'){const u=one('SELECT * FROM users WHERE id=?',+m[1]);if(!u)err('用户不存在',404);return json({...publicUser(u),following:!!(me&&one('SELECT 1 FROM follows WHERE user_id=? AND target_id=?',me.id,u.id)),followers:one('SELECT count(*) n FROM follows WHERE target_id=?',u.id).n,posts:all(postSql+' WHERE p.user_id=? ORDER BY p.id DESC',u.id)});}
 if(!me)err('登录后就能参与啦',401);
 if(path==='/api/me'&&method==='PATCH'){const b=await body(req);run('UPDATE users SET name=?,bio=?,interests=? WHERE id=?',str(b.name,30),str(b.bio,200),str(b.interests,150),me.id);return json(publicUser(one('SELECT * FROM users WHERE id=?',me.id)));}
 if(path==='/api/posts'&&method==='POST'){
  const b=await body(req);if(!categories.includes(b.category))err('请选择有效分类');const image=str(b.image,4000000);if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)&&!/^https:\/\/images\.unsplash\.com\/[^\s"<>]+$/.test(image))err('请上传 JPG、PNG 或 WebP 图片');
  const id=run('INSERT INTO posts(user_id,title,body,place,category,budget,hours,lat,lon,indoor,image) VALUES(?,?,?,?,?,?,?,?,?,?,?)',me.id,str(b.title,60),str(b.body,4000),str(b.place,80),b.category,num(b.budget,0,100000),num(b.hours,.5,168),num(b.lat,-90,90),num(b.lon,-180,180),b.indoor?1:0,image).lastInsertRowid;return json({id:Number(id)},201);
 }
 m=path.match(/^\/api\/posts\/(\d+)\/(like|comment|repost|group)$/);
 if(m&&method==='POST'){
  const id=+m[1],action=m[2],p=one('SELECT * FROM posts WHERE id=?',id);if(!p)err('帖子不存在',404);const b=await body(req);
  if(action==='like'){if(one('SELECT 1 FROM likes WHERE user_id=? AND post_id=?',me.id,id))run('DELETE FROM likes WHERE user_id=? AND post_id=?',me.id,id);else run('INSERT INTO likes VALUES(?,?)',me.id,id);}
  if(action==='comment')run('INSERT INTO comments(user_id,post_id,body) VALUES(?,?,?)',me.id,id,str(b.body));
  if(action==='repost'){const newId=run('INSERT INTO posts(user_id,title,body,place,category,budget,hours,lat,lon,indoor,image,original_id,demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',me.id,p.title,`${b.body?str(b.body,500)+'\n\n':''}转发记录：\n${p.body}`,p.place,p.category,p.budget,p.hours,p.lat,p.lon,p.indoor,p.image,p.original_id||p.id,p.demo).lastInsertRowid;return json({id:Number(newId)});}
  if(action==='group'){const date=str(b.date,30);if(!Number.isFinite(Date.parse(date))||Date.parse(date)<=Date.now())err('请选择未来的出发时间');const capacity=num(b.capacity,2,20);if(!Number.isInteger(capacity))err('人数须为整数');const gid=run('INSERT INTO groups(post_id,user_id,date,capacity) VALUES(?,?,?,?)',id,me.id,date,capacity).lastInsertRowid;run('INSERT INTO members VALUES(?,?)',gid,me.id);}
  return json({ok:true});
 }
 m=path.match(/^\/api\/groups\/(\d+)\/join$/);
 if(m&&method==='POST'){const g=one('SELECT * FROM groups WHERE id=?',+m[1]);if(!g)err('组团不存在',404);if(Date.parse(g.date)<=Date.now())err('组团已过期');if(one('SELECT 1 FROM members WHERE group_id=? AND user_id=?',g.id,me.id))err('你已加入该组团');if(one('SELECT count(*) n FROM members WHERE group_id=?',g.id).n>=g.capacity)err('组团已满员');run('INSERT INTO members VALUES(?,?)',g.id,me.id);return json({ok:true});}
 m=path.match(/^\/api\/users\/(\d+)\/follow$/);
 if(m&&method==='POST'){const id=+m[1];if(id===me.id||!one('SELECT id FROM users WHERE id=?',id))err('无法关注该用户');if(one('SELECT 1 FROM follows WHERE user_id=? AND target_id=?',me.id,id))run('DELETE FROM follows WHERE user_id=? AND target_id=?',me.id,id);else run('INSERT INTO follows VALUES(?,?)',me.id,id);return json({ok:true});}
 if(path==='/api/friends'&&method==='GET')return json(all('SELECT u.id,u.name,u.bio,EXISTS(SELECT 1 FROM follows WHERE user_id=u.id AND target_id=?) mutual FROM follows f JOIN users u ON u.id=f.target_id WHERE f.user_id=?',me.id,me.id));
 if(path==='/api/conversations'&&method==='GET')return json(all(`SELECT u.id,u.name,(SELECT body FROM messages WHERE (sender=u.id AND recipient=?) OR (sender=? AND recipient=u.id) ORDER BY id DESC LIMIT 1) last FROM users u WHERE u.id IN (SELECT sender FROM messages WHERE recipient=? UNION SELECT recipient FROM messages WHERE sender=?)`,me.id,me.id,me.id,me.id));
 m=path.match(/^\/api\/messages\/(\d+)$/);
 if(m){const id=+m[1];if(id===me.id||!one('SELECT id FROM users WHERE id=?',id))err('无法发送给该用户');if(method==='GET')return json(all('SELECT * FROM messages WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?) ORDER BY id LIMIT 500',me.id,id,id,me.id));if(method==='POST'){const b=await body(req);run('INSERT INTO messages(sender,recipient,body) VALUES(?,?,?)',me.id,id,str(b.body));return json({ok:true});}}
 err('接口不存在',404);
 }catch(e){if(!e.status)console.error(e);json({error:e.status?e.message:'服务暂时不可用'},e.status||500);}
});
server.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log(`出个门 http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000}`));
