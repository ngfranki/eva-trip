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
  // First 12 characters of each revised WebP's SHA-256. An absent tile keeps its original atlas panel.
  const tileRevisions={'narita-b1':'506881713572','tokachi-b29':'c19e0db2fa1f'};
  const atlasRevisions={};
  // Each sparse overlay has its original atlas dimensions and lists only the tiles it corrects.
  const overlayRevisions={
    "akan":{"rev":"08afd52883ce","tiles":[4]},
    "biei":{"rev":"94eecdf9c82f","tiles":[2,7]},
    "chitose":{"rev":"2c0921813e0d","tiles":[7]},
    "chitose-b":{"rev":"50ab490e1700","tiles":[10,11,12,13,14,15,16,18,19]},
    "cranes":{"rev":"9dbd65e7429f","tiles":[14]},
    "default":{"rev":"aac3de9c851c","tiles":[1,7,13,16]},
    "farm":{"rev":"2758f42d4239","tiles":[4,7,8,11,13]},
    "furano":{"rev":"8d89f832a68d","tiles":[14]},
    "haneda":{"rev":"627adc008342","tiles":[4,10,12]},
    "hkairport":{"rev":"811bca323825","tiles":[1]},
    "hongkong":{"rev":"cdac45524053","tiles":[1,13]},
    "ikebukuro":{"rev":"3eac653f613a","tiles":[6,7,12,17,18]},
    "kushiro":{"rev":"8b3a8b0df30f","tiles":[7]},
    "kussharo":{"rev":"93c2e99f0902","tiles":[4,7]},
    "marsh":{"rev":"06ee2357488e","tiles":[4,10]},
    "moere":{"rev":"a93c0904ed41","tiles":[1,4,7,14,17]},
    "narita":{"rev":"3c73241781f7","tiles":[12,15]},
    "narita-b":{"rev":"c716756f3c0f","tiles":[0,2,3,4,5,6,7,8,9,10]},
    "obihiro":{"rev":"3b67408a9392","tiles":[7,18]},
    "otaru":{"rev":"3791dd540955","tiles":[9]},
    "roppongi":{"rev":"ee08e606e29f","tiles":[12]},
    "rusutsu":{"rev":"4b6c964db70a","tiles":[7,11,16,18]},
    "sapporo":{"rev":"e925743f436f","tiles":[9]},
    "spot-027c9d1e1":{"rev":"232e8945726d","tiles":[9]},
    "spot-06158d8b5":{"rev":"6731f8f91c15","tiles":[10,12]},
    "spot-10e7818ff":{"rev":"b81ab9cee190","tiles":[7]},
    "spot-1163438dd":{"rev":"c88b184958b6","tiles":[0,4,5,6,7,8,9,10,11,12,13,14,15,16]},
    "spot-147b71db6":{"rev":"416d411bcde1","tiles":[7,9]},
    "spot-1a6f6070c-b":{"rev":"4a7e3923c6c1","tiles":[0,1,3,4,6,7,8,10,12,13,14,15,18,21,25,26,27]},
    "spot-1d625ae4f-b":{"rev":"11a35598e9aa","tiles":[1,2,3,6,7,9]},
    "spot-1f13a90b8":{"rev":"7c6cfdd1cf96","tiles":[0,3,5,7,9,10,13,14,15,16,18,19]},
    "spot-1f13a90b8-b":{"rev":"cb3807c7cf11","tiles":[0,1,3,4,5,6,7,8,9,12,14,17,18,20,21,22,23,25,26,27,28,29]},
    "spot-266ac0336":{"rev":"1c92bfe9e476","tiles":[7,12]},
    "spot-269608d5a":{"rev":"fe0e7d68ff92","tiles":[2,14]},
    "spot-2e38dcad4":{"rev":"de1a9beaeb6c","tiles":[11,12]},
    "spot-31c4556cc":{"rev":"a81956a4427b","tiles":[13,14]},
    "spot-33cad23f7":{"rev":"7e078e457fee","tiles":[7]},
    "spot-33cad23f7-b":{"rev":"02e718f4d3a5","tiles":[5,6,8,9,12,13,14,15,17,20,21,25,26]},
    "spot-3c6782d38":{"rev":"6d3a6ba12242","tiles":[14]},
    "spot-3f5a2f8fc":{"rev":"f086f04ef697","tiles":[0,1,2,3,7,13,16,17,18,19]},
    "spot-3f5a2f8fc-b":{"rev":"ff81a2823c9c","tiles":[0,1,3,4,5,6,7,8,9,10,12,13,14,15,17,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-3fb8e59e3":{"rev":"c785d47e5bd2","tiles":[0,3,4,5,6,7,8,10,11,12,14,15,16,19]},
    "spot-3fb8e59e3-b":{"rev":"049c60898a36","tiles":[0,2,3,4,5,6,8,9,12,13,14,17,18,20,21,25,28,29]},
    "spot-41089f741":{"rev":"8e1833296fca","tiles":[10]},
    "spot-4238daf29":{"rev":"bafaee066355","tiles":[2,9]},
    "spot-4398c48a7":{"rev":"717ad5046dbd","tiles":[9,11,15]},
    "spot-46fc6bef6":{"rev":"975e8b2c7046","tiles":[7]},
    "spot-4732296ba":{"rev":"66dde1f8f965","tiles":[12]},
    "spot-495afce62":{"rev":"2350bb5f026c","tiles":[12,14]},
    "spot-49779f027":{"rev":"5e265107b247","tiles":[7,12,14]},
    "spot-51652ebdc":{"rev":"09852006ec17","tiles":[9]},
    "spot-54f5ce43e":{"rev":"7b3805db985d","tiles":[16]},
    "spot-569b08bba":{"rev":"081b3124469c","tiles":[4,5,7,8,10,12,14]},
    "spot-569b08bba-b":{"rev":"20a7e322b029","tiles":[0,1,3,4,5,6,8,9,10,14,15,17,18,19,20,21,23,25,26,27,29]},
    "spot-59c3d0ebd":{"rev":"7f8a63b309a1","tiles":[2,9,11,13,17]},
    "spot-5df3b4a31":{"rev":"99a3dba5bf36","tiles":[4]},
    "spot-627afeabe":{"rev":"9ee8d64aa3dd","tiles":[12]},
    "spot-628c4952e":{"rev":"c8a972d247c2","tiles":[4,9]},
    "spot-628c4952e-b":{"rev":"c32b446fee1d","tiles":[0,1,3,4,5,8,10,13,14,17,18,19,21,22,23,25,26,27,28]},
    "spot-66c6acb84":{"rev":"97246766c9c9","tiles":[2,4,5,13]},
    "spot-66c6acb84-b":{"rev":"d1ce065201b9","tiles":[0,1,3,4,6,7,8,10,12,13,14,15,17,18,19,20,21,23,25,26,27,28]},
    "spot-697bbef9b":{"rev":"69ad19df1442","tiles":[0,1,2,3,4,6,8,9,13,16,17,18,19]},
    "spot-697bbef9b-b":{"rev":"5614e56eafc1","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,17,19,20,21,25,26,27,28,29]},
    "spot-78367cc4f":{"rev":"338311576cd1","tiles":[13,15]},
    "spot-7955326ed":{"rev":"11c74f603f73","tiles":[8,12,14]},
    "spot-79865f593":{"rev":"68a20e51f5c4","tiles":[0,8,9,12,13,16]},
    "spot-79865f593-b":{"rev":"6c750f7ada77","tiles":[0,1,3,4,5,6,7,8,9,10,12,13,14,15,18,19,20,21,22,23,25,27,28,29]},
    "spot-7c1b27ec2":{"rev":"a793d4916773","tiles":[4,7]},
    "spot-7fef43934":{"rev":"8d9ca06408b6","tiles":[9,13,18]},
    "spot-86577f3e8":{"rev":"cf23b9d582dc","tiles":[7]},
    "spot-86b29bbb2":{"rev":"be6334feaaa8","tiles":[7,13]},
    "spot-881d1794c":{"rev":"a6f83018e614","tiles":[13]},
    "spot-885eb86b5":{"rev":"c488ce68dc31","tiles":[13]},
    "spot-89ba4f10d":{"rev":"dfea1c50ecc3","tiles":[4,7,12]},
    "spot-8f335641b":{"rev":"922d7a63f424","tiles":[7,10,13]},
    "spot-90e680279":{"rev":"26e33f022d33","tiles":[11]},
    "spot-a52910691":{"rev":"7df4c439ea49","tiles":[4]},
    "spot-a7566ef75":{"rev":"0f88d3903477","tiles":[0,3,4,7,8,11,12,13,15,16,18,19]},
    "spot-a7566ef75-b":{"rev":"b43bf48b71d1","tiles":[0,3,4,5,6,7,8,9,10,12,13,14,17,23,25,26,28,29]},
    "spot-ac4485fba":{"rev":"20045b428de9","tiles":[7,13]},
    "spot-b531cf1e9":{"rev":"3e8b08858efe","tiles":[9]},
    "spot-bbf221799":{"rev":"d18150d38f81","tiles":[13]},
    "spot-bbf221799-b":{"rev":"041425d3fe69","tiles":[0,3,4,5,6,7,8,9,10,12,13,14,17,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-c01dc34a3":{"rev":"07081ae18302","tiles":[7]},
    "spot-c1f3498b7":{"rev":"e61fa885f1ef","tiles":[7]},
    "spot-c6a0e8931":{"rev":"a8aa7c46d38d","tiles":[1,8,11,12,17]},
    "spot-c6a0e8931-b":{"rev":"2c6067b541b1","tiles":[0,3,4,6,8,12,13,14,15,19,21,25,27,29]},
    "spot-c8601530f":{"rev":"7312cb0824e0","tiles":[5]},
    "spot-cb578c594":{"rev":"f01dbf52bf5e","tiles":[8]},
    "spot-cc31e7e93":{"rev":"8600a27d27de","tiles":[4,5,9,10,12,15]},
    "spot-cc31e7e93-b":{"rev":"c63b5da4e2f2","tiles":[0,1,2,3,4,5,8,9,10,13,14,17,18,19,21]},
    "spot-ceed47a35":{"rev":"050bdaa649fd","tiles":[13]},
    "spot-ceed47a35-b":{"rev":"91959746e08d","tiles":[0,1,2,3,4,5,6,8,13,14,15,17,19,21,25,27,28]},
    "spot-d1c54f9ac":{"rev":"54ac5820a87d","tiles":[7]},
    "spot-da027a45c":{"rev":"c8dafd9e73f6","tiles":[7,14]},
    "spot-df94bb662":{"rev":"11f36ffa0d5c","tiles":[6]},
    "spot-e2a5a2ae7":{"rev":"1a46dbc7af78","tiles":[11]},
    "spot-e2b4a3c27":{"rev":"534816a599e4","tiles":[0,3,5,7,9,10,12,13,15,18]},
    "spot-e2b4a3c27-b":{"rev":"c48b26b448b2","tiles":[0,1,2,3,5,6,8,9,10,13,16,18,19,20,21,25,26,27,28,29]},
    "spot-e3447714a":{"rev":"efe1e24c9597","tiles":[8,11,13]},
    "spot-e4f890e25":{"rev":"cbde259250fd","tiles":[13]},
    "spot-e67324d3f":{"rev":"26c45c1deca1","tiles":[0,7,12,18,19]},
    "spot-e67324d3f-b":{"rev":"0722095dadd1","tiles":[0,2,3,4,6,7,8,9,10,12,13,14,15,17,19,20,21,22,25,26,27,28,29]},
    "spot-efe273a59-b":{"rev":"a0235092a66f","tiles":[2,4,12,14,15,18,19,20,23,25,26,28,29]},
    "spot-f029df4f6":{"rev":"024558e1a090","tiles":[4,5,6,8,11,12,14,19]},
    "spot-f029df4f6-b":{"rev":"3688c77339ed","tiles":[1,2,3,4,5,6,7,8,9,10,12,13,14,17,22,25,26,28,29]},
    "spot-f3cd60482-b":{"rev":"7e42452c5bf0","tiles":[1,4,8,20,24,26,27,28]},
    "spot-f3d63d0ed":{"rev":"b2ee43e2f4b2","tiles":[13]},
    "spot-f7cce1fae":{"rev":"a200eee98c5a","tiles":[7,13]},
    "spot-f7cce1fae-b":{"rev":"3d2d21a5bf5c","tiles":[10,11,17,24,25,29]},
    "spot-fb71239cf":{"rev":"33df4fa40af7","tiles":[7,8]},
    "spot-fb71239cf-b":{"rev":"0b3240e57428","tiles":[0,1,5,6,8,9,10,14,15,16,17,20,21,23,26]},
    "tokachi":{"rev":"b962b660da4e","tiles":[2]},
    "tokachi-b":{"rev":"a5252833cd1c","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28]},
    "tokyo":{"rev":"6da641a43c64","tiles":[7,11]},
    "tomamu":{"rev":"914c9739a3e3","tiles":[4,14]},
    "toya":{"rev":"28205ef6262d","tiles":[7]}
  };
  function atlasPath(stem){
    const rev=atlasRevisions[stem];
    return 'hero/atlas/'+stem+'.webp'+(rev?'?rev='+rev:'');
  }
  function tilePath(stem){
    return 'hero/edits/'+stem+'.webp?rev='+tileRevisions[stem];
  }
  function overlayPath(stem){
    return 'hero/corrections/'+stem+'.webp?rev='+overlayRevisions[stem].rev;
  }
  function offlineArtwork(){
    return Object.keys(tileRevisions).map(tilePath).concat(
      Object.keys(overlayRevisions).map(overlayPath),
      SCENE_KEYS.flatMap(key=>[atlasPath(key),atlasPath(key+'-b')])
    );
  }
  function artwork(key,scene,night,light){
    let tile=-1;
    if(scene.covered && ['rain','downpour'].includes(scene.kind)) tile=night?28:light==='morning'?26:27;
    else if(scene.covered && scene.kind==='snow' && !night && light!=='morning') tile=29;
    else if(night && nightKinds.includes(scene.kind)) tile=14+nightKinds.indexOf(scene.kind);
    else if(!night && light==='morning' && morningKinds.includes(scene.kind)) tile=morningKinds.indexOf(scene.kind);
    else if(scene.kind==='downpour') tile=25;
    const extra=tile>=0;
    if(!extra) tile=panels.indexOf(scene.image);
    const edit=key+(extra?'-b':'-a')+tile;
    if(tileRevisions[edit]) return {path:tilePath(edit),tile,standalone:true};
    const cols=extra?5:4, rows=extra?6:5;
    const stem=key+(extra?'-b':'');
    const art={path:atlasPath(stem),tile,cols,rows,
      x:(tile%cols)/(cols-1)*100,y:Math.floor(tile/cols)/(rows-1)*100};
    if(overlayRevisions[stem]?.tiles.includes(tile)) art.overlay=overlayPath(stem);
    return art;
  }
  return {places,entry,nearest,planned,resolve,panels,condition,artwork,offlineArtwork};
})();
