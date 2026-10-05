export function distance(lat, lon, a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(a-lat)/2)**2 + Math.cos(rad(lat))*Math.cos(rad(a))*Math.sin(rad(b-lon)/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}
export function recommend(posts, {lat=30.25,lon=120.15,budget=500,hours=24,interests='',category='',q='',weather=null,radius=100}={}) {
  return posts.map(p => {
    const km=distance(+lat,+lon,p.lat,p.lon), reasons=[];
    let score=Math.max(0,30-km);
    if(interests.split(',').includes(p.category)) { score+=30; reasons.push('符合你的兴趣'); }
    if(weather) { const wet=weather.code>=51; if(p.indoor===Number(wet)) {score+=20; reasons.push(wet?'雨天也能安心逛':'适合户外走走');} }
    if(p.hours<=+hours) {score+=10; reasons.push(`${p.hours} 小时轻松逛`);}
    if(km<5) reasons.unshift('就在你附近');
    return {...p,distance:Math.round(km*10)/10,score,reason:reasons[0]||'发现城市新去处'};
  }).filter(p=>p.distance<=+radius && p.budget<=+budget && p.hours<=+hours && (!category||p.category===category) && (!q||`${p.title}${p.place}${p.body}`.toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>b.score-a.score||b.id-a.id);
}
