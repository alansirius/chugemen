// Fixtures are created only for experience accounts, never registered accounts.
export function seedDemo(db, userId) {
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  if(one('SELECT 1 FROM demo_profiles WHERE user_id=?',userId)) return;
  db.exec('BEGIN');
  try {
    run('INSERT INTO demo_profiles(user_id) VALUES(?)',userId);
    run('UPDATE users SET bio=?,interests=? WHERE id=?','杭州 · 喜欢散步、咖啡和没有闹钟的周末。','城市漫步,咖啡美食,户外自然',userId);
    const chats=[
      ['这周末去九溪吗？我看了路线，走走停停大概三个小时。','好呀，我想沿着溪水慢慢走，顺便拍点照片。','那我们九点在九溪公交站见，记得穿防滑鞋。'],
      ['你上次发的美术馆照片好好看！这个周末还有空吗？','有空，想看完展再去湖边散步。','可以！我先确认一下预约时间，再发给你。'],
      ['青芝坞那家咖啡馆我去过，靠窗的位置很舒服。','收藏了，下次带本书去坐一下午。','下次一起呀，逛完还可以去植物园。']
    ];
    for(let i=1;i<=3;i++) {
      run('INSERT OR IGNORE INTO follows VALUES(?,?)',userId,i);
      run('INSERT OR IGNORE INTO follows VALUES(?,?)',i,userId);
      chats[i-1].forEach((text,j)=>run('INSERT INTO messages(sender,recipient,body,created) VALUES(?,?,?,?)',j===1?userId:i,j===1?i:userId,text,new Date(Date.now()-((4-i)*3600+(3-j)*180)*1000).toISOString().slice(0,19).replace('T',' ')));
    }
    const records=[
      [2,'沿着西湖走了两小时，今天的快乐只花了 25 元','没有排满行程，带了杯茶就出门了。走到喜欢的地方就坐一会儿，湖边的风让人很放松。\n我的路线：曲院风荷 → 苏堤。人均 25 元是饮料和小零食。',25],
      [3,'周末给自己留一杯咖啡的时间','在青芝坞找了个靠窗的位置，终于读完了放在包里很久的书。推荐把下午空出来，慢慢逛，慢慢坐。',48],
      [1,'第一次走九溪，这条绿色路线想再来一次','和朋友沿着溪水散步，一路都在拍树影。建议带水、穿好走的鞋，下雨后石头会滑。\n周末记录示例，出发前请确认天气。',0]
    ];
    records.forEach(([source,title,body,budget],index)=>{
      const p=one('SELECT * FROM posts WHERE id=?',source);
      const id=run('INSERT INTO posts(user_id,title,body,place,category,budget,hours,lat,lon,indoor,image,demo,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',userId,title,body,p.place,p.category,budget,p.hours,p.lat,p.lon,p.indoor,p.image,1,new Date(Date.now()-(index+1)*86400000).toISOString().slice(0,19).replace('T',' ')).lastInsertRowid;
      for(let friend=1;friend<=3;friend++) run('INSERT INTO likes VALUES(?,?)',friend,id);
      run('INSERT INTO comments(user_id,post_id,body) VALUES(?,?,?)',index+1,id,['这条路线我也喜欢，下次一起！','周末就该这样慢慢过。','照片很有感觉，已经加入想去清单。'][index]);
    });
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
