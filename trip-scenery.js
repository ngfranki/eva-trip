// Coordinates describe public landmarks; each trip keeps its own time-slot choices.
const TripScenery = (() => {
  const places = {
    hkairport:['香港國際機場',22.308,113.918,5], hongkong: ['香港',22.30,114.17,55], tokyo:['東京',35.68,139.76,28],
    narita:['成田機場',35.772,140.393,9], ueno:['上野',35.716,139.772,2],
    roppongi:['六本木',35.661,139.731,2], ikebukuro:['池袋',35.729,139.719,3],
    farm:['Mother Farm',35.248,139.936,5], haneda:['羽田',35.550,139.785,7],
    obihiro:['帶廣',42.918,143.201,11], tokachi:['十勝',43.23,143.30,65],
    cranes:['阿寒丹頂之里',43.144,144.146,12], kushiro:['釧路',42.982,144.385,18],
    akan:['阿寒湖',43.434,144.095,22], kussharo:['屈斜路湖',43.628,144.347,25],
    marsh:['釧路濕原',43.101,144.477,18], tomamu:['Tomamu',43.064,142.63,20],
    furano:['富良野',43.325,142.354,24], biei:['美瑛',43.55,142.47,20],
    otaru:['小樽',43.20,141.00,15], rusutsu:['留壽都',42.736,140.88,20],
    toya:['洞爺湖',42.56,140.82,20], sapporo:['札幌',43.062,141.354,35],
    moere:['莫埃來沼公園',43.123,141.431,3], chitose:['新千歲機場',42.775,141.692,10]
  };
  const landmarkRadius={ueno:0.7,roppongi:0.55,ikebukuro:0.55,cranes:1.5,marsh:1.8,tomamu:3,toya:7,kushiro:6,moere:1.8,haneda:5};
  function nearest(lat,lng,distance){
    let found=null, best=Infinity;
    if(lat==null || lng==null) return null;
    for(const [key,[,y,x,radius]] of Object.entries(places)){
      const km=distance([lat,lng],[y,x]);
      if(km<=(landmarkRadius[key] || radius) && km<best){found=key; best=km;}
    }
    return found;
  }
  // A place binding is saved with the private trip. Shared artwork contains no trip coordinates.
  function entry(trip,key){
    const stop=trip?.sceneStops?.[key];
    const row=stop || places[key];
    return row && {key,place:row[0],lat:row[1],lng:row[2],q:row[0],src:'stop'};
  }
  function planned(trip,now){
    if(!trip) return null;
    const jp=new Date(now.getTime()+9*3600000);
    const date=jp.toISOString().slice(0,10), minutes=jp.getUTCHours()*60+jp.getUTCMinutes();
    const events=trip.sceneSchedule?.[date];
    if(events){
      const event=events.slice().reverse().find(([start])=>minutes>=start);
      if(event) return entry(trip,event[1]);
    }
    const slots=trip.sceneDays?.[date];
    return slots ? entry(trip,slots[minutes<660?0:minutes<1020?1:2]) : null;
  }
  function resolve(trip,lat,lng,distance,choice,hint,accuracy){
    const nearby=[];
    if(Number.isFinite(lat) && Number.isFinite(lng)){
      for(const [key,[place,y,x]] of Object.entries(trip?.sceneStops || {})){
        if(!SCENE_KEYS.includes(key)) continue;
        const km=distance([lat,lng],[y,x]);
        if(km<=0.22) nearby.push({key,place,km});
      }
    }
    nearby.sort((a,b)=>a.km-b.km);
    const tolerance=Math.max(.06,Math.min(.20,(accuracy||0)/1000));
    const options=nearby.filter(x=>x.km<=nearby[0].km+tolerance);
    const uncertainty=Math.min(.06,Math.max(.005,(accuracy||0)/1000));
    const plannedMatch=options.find(x=>x.key===hint && x.km<=options[0].km+uncertainty);
    const picked=options.find(x=>x.key===choice) || plannedMatch || options[0];
    return {key:picked?.key || nearest(lat,lng,distance) || 'default', options};
  }
  const panels=['dawn','day','dusk','night','partly','overcast','fog','wind','rain','nightrain','freezingrain','sleet','storm','hail','heavysnow','blizzard','snow','nightsnow','cover','nightcover'];
  function condition(wx,night,light){
    let code=wx.code;
    const covered=wx.depth>0;
    if(code==null && wx.label){
      const first=wx.label.split(/時々|一時|のち|の後|後轉|間中|有時/)[0];
      const fallback=[[/雹/,96],[/雷/,95],[/凍雨|着氷/,66],[/大雪|暴雪/,75],[/雪/,71],[/豪雨|大雨/,65],[/雨/,61],[/霧/,45],[/陰|曇|密雲/,3],[/雲/,2],[/晴/,0]];
      const match=fallback.find(([pattern])=>pattern.test(first));
      if(match) code=match[1];
    }
    const snowy=wx.snowfall>0 || [71,73,75,77,85,86].includes(code);
    const rainy=wx.rainNow>0 || (code>=51 && code<=67) || [80,81,82].includes(code);
    const windy=wx.wind>=40 || wx.gust>=60;
    let image, kind;
    if(code===96 || code===99) kind='hail';
    else if(code===95) kind='storm';
    else if([56,57,66,67].includes(code)) kind='freezingrain';
    else if(snowy && windy) kind='blizzard';
    else if(snowy && rainy) kind='sleet';
    else if(code===75 || code===86 || wx.snowfall>=1) kind='heavysnow';
    else if(snowy) kind='snow';
    else if(code===65 || code===82 || wx.rainNow>=7.5) kind='downpour';
    else if(rainy) kind='rain';
    else if(code===45 || code===48 || (wx.visibility!=null && wx.visibility<1000)) kind='fog';
    else if(windy) kind='wind';
    else if(covered) kind='cover';
    else if(code===3) kind='overcast';
    else if(code===2) kind='partly';
    else kind='clear';
    if(kind==='clear') image=night?'night':light==='morning'?'dawn':light==='evening'?'dusk':'day';
    else if(night && ['cover','rain','snow'].includes(kind)) image='night'+kind;
    else image=kind==='downpour'?(night?'nightrain':'rain'):kind;
    return {image,kind,covered,sky:snowy?'snow':rainy?'rain':''};
  }
  const morningKinds=['partly','overcast','fog','wind','rain','downpour','freezingrain','sleet','storm','hail','heavysnow','blizzard','snow','cover'];
  const nightKinds=['partly','overcast','fog','wind','downpour','freezingrain','sleet','storm','hail','heavysnow','blizzard'];
  function artwork(key,scene,night,light){
    let tile=-1;
    if(scene.covered && ['rain','downpour'].includes(scene.kind)) tile=night?28:light==='morning'?26:27;
    else if(scene.covered && scene.kind==='snow' && !night && light!=='morning') tile=29;
    else if(night && nightKinds.includes(scene.kind)) tile=14+nightKinds.indexOf(scene.kind);
    else if(!night && light==='morning' && morningKinds.includes(scene.kind)) tile=morningKinds.indexOf(scene.kind);
    else if(scene.kind==='downpour') tile=25;
    const extra=tile>=0;
    if(!extra) tile=panels.indexOf(scene.image);
    const cols=extra?5:4, rows=extra?6:5;
    return {path:'hero/atlas/'+key+(extra?'-b':'')+'.webp',tile,cols,rows,
      x:(tile%cols)/(cols-1)*100,y:Math.floor(tile/cols)/(rows-1)*100};
  }
  return {places,entry,nearest,planned,resolve,panels,condition,artwork};
})();
