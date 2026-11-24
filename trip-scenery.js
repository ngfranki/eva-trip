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
    "akan-b":{"rev":"8db93a29f113","tiles":[0,1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "biei":{"rev":"94eecdf9c82f","tiles":[2,7]},
    "biei-b":{"rev":"ffcf6e73f51e","tiles":[0,1,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,21,22,23,24,25,26,27,28,29]},
    "chitose":{"rev":"2c0921813e0d","tiles":[7]},
    "chitose-b":{"rev":"5897703c015b","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "cranes":{"rev":"9dbd65e7429f","tiles":[14]},
    "cranes-b":{"rev":"4de6cace1270","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "default":{"rev":"63680098c4db","tiles":[1,7,9,13,16]},
    "default-b":{"rev":"2a38596f457e","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,22,23,26,28,29]},
    "farm":{"rev":"2758f42d4239","tiles":[4,7,8,11,13]},
    "farm-b":{"rev":"979350bb41c0","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "furano":{"rev":"8d89f832a68d","tiles":[14]},
    "furano-b":{"rev":"52c341b967ea","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "haneda":{"rev":"627adc008342","tiles":[4,10,12]},
    "haneda-b":{"rev":"c532dacc8d9a","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,28,29]},
    "hkairport":{"rev":"811bca323825","tiles":[1]},
    "hkairport-b":{"rev":"40f4251a35a7","tiles":[0,1,2,3,4,5,6,7,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "hongkong":{"rev":"1c5206374d36","tiles":[1,3,13]},
    "hongkong-b":{"rev":"6f85956d35f0","tiles":[0,1,3,4,5,6,7,8,9,10,11,12,13,14,17,18,19,20,22,23,24,26,27,28,29]},
    "ikebukuro":{"rev":"3eac653f613a","tiles":[6,7,12,17,18]},
    "ikebukuro-b":{"rev":"6fd0ab90b6fb","tiles":[0,1,2,3,4,5,6,7,8,9,12,13,14,15,16,17,18,19,20,21,23,24,25,26,27,28,29]},
    "kushiro":{"rev":"ba38cfd09b0c","tiles":[0,3,7,16,18,19]},
    "kushiro-b":{"rev":"ebb67b2e06f4","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "kussharo":{"rev":"93c2e99f0902","tiles":[4,7]},
    "kussharo-b":{"rev":"9944c161d983","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "marsh":{"rev":"06ee2357488e","tiles":[4,10]},
    "marsh-b":{"rev":"a6d300014427","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "moere":{"rev":"a93c0904ed41","tiles":[1,4,7,14,17]},
    "moere-b":{"rev":"c14e2ff00b18","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "narita":{"rev":"8975a1809016","tiles":[11,12,15]},
    "narita-b":{"rev":"ef77dd06e0b1","tiles":[0,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20,22,23,24,25,26,27,28,29]},
    "obihiro":{"rev":"1c28bd332a3d","tiles":[7,13,18]},
    "obihiro-b":{"rev":"321af68bc5af","tiles":[0,1,7,9,10,11,12,13,14,15,17,18,19,20,21,22,23,24,25,26,27,28]},
    "otaru":{"rev":"3791dd540955","tiles":[9]},
    "otaru-b":{"rev":"99135fb02c46","tiles":[2,6,8,9,10,12,13,14,15,17,18,19,20,21,22,28]},
    "roppongi":{"rev":"ee08e606e29f","tiles":[12]},
    "roppongi-b":{"rev":"b764aec7a39f","tiles":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "rusutsu":{"rev":"15835914c6d3","tiles":[7,11,13,16,18]},
    "rusutsu-b":{"rev":"2bf72b4555ef","tiles":[0,1,2,3,4,5,6,8,9,10,11,12,13,14,15,16,17,19,22,25,27,29]},
    "sapporo":{"rev":"e925743f436f","tiles":[9]},
    "sapporo-b":{"rev":"5740a0a2757d","tiles":[0,5,6,7,8,9,10,11,13,14,15,17,18,19,21,22,23,24,25,26,27,28,29]},
    "spot-027c9d1e1":{"rev":"ffc74a33bb42","tiles":[0,9,16]},
    "spot-027c9d1e1-b":{"rev":"086938d54552","tiles":[0,1,2,3,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,25,26,27,29]},
    "spot-06158d8b5":{"rev":"a04051825e6b","tiles":[10,12,13]},
    "spot-06158d8b5-b":{"rev":"43ece873eb3f","tiles":[1,2,3,4,5,7,8,9,10,12,13,15,16,17,18,19,20,21,22,23,25,26,28,29]},
    "spot-10e7818ff":{"rev":"b81ab9cee190","tiles":[7]},
    "spot-10e7818ff-b":{"rev":"4badf5486baf","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,23,24,25,26,27,28,29]},
    "spot-1163438dd":{"rev":"c88b184958b6","tiles":[0,4,5,6,7,8,9,10,11,12,13,14,15,16]},
    "spot-1163438dd-b":{"rev":"e5d1320756fa","tiles":[0,3,7,10,13,14,17,18,20,22,25,27,28]},
    "spot-147b71db6":{"rev":"416d411bcde1","tiles":[7,9]},
    "spot-147b71db6-b":{"rev":"2f011d25f228","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,23,25,26,27]},
    "spot-1501f4191":{"rev":"1e405a0f6ecd","tiles":[13]},
    "spot-1501f4191-b":{"rev":"97bed0a75cef","tiles":[22]},
    "spot-1a6f6070c-b":{"rev":"de33d3916e6a","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-1d625ae4f":{"rev":"d953b4ddb572","tiles":[13]},
    "spot-1d625ae4f-b":{"rev":"3e4f23ac0943","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,17,18,19,21,22,23,24,25,26,27,28,29]},
    "spot-1f13a90b8":{"rev":"7c6cfdd1cf96","tiles":[0,3,5,7,9,10,13,14,15,16,18,19]},
    "spot-1f13a90b8-b":{"rev":"7409b18fab2a","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29]},
    "spot-266ac0336":{"rev":"016e874e488a","tiles":[0,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19]},
    "spot-266ac0336-b":{"rev":"8c9f89513548","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-269608d5a":{"rev":"fe0e7d68ff92","tiles":[2,14]},
    "spot-269608d5a-b":{"rev":"0d5bced77beb","tiles":[0,1,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-29d2293a9":{"rev":"ff2c5802e46d","tiles":[9]},
    "spot-29d2293a9-b":{"rev":"8bdc6175a5cd","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-2e38dcad4":{"rev":"de1a9beaeb6c","tiles":[11,12]},
    "spot-2e38dcad4-b":{"rev":"6dd6c78b0606","tiles":[0,1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-31c4556cc":{"rev":"a81956a4427b","tiles":[13,14]},
    "spot-31c4556cc-b":{"rev":"97cc430c4588","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-330159020-b":{"rev":"27f5305b8a80","tiles":[0,7,8,10,17,22,25,29]},
    "spot-33cad23f7":{"rev":"7e078e457fee","tiles":[7]},
    "spot-33cad23f7-b":{"rev":"681d71581abb","tiles":[0,1,2,3,4,5,6,8,9,11,12,13,14,15,17,18,20,21,23,24,25,26,27,28,29]},
    "spot-3c6782d38":{"rev":"95e40e1907f0","tiles":[13,14]},
    "spot-3c6782d38-b":{"rev":"367bb9a03438","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-3f5a2f8fc":{"rev":"f086f04ef697","tiles":[0,1,2,3,7,13,16,17,18,19]},
    "spot-3f5a2f8fc-b":{"rev":"89f176ae1bd1","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-3fb8e59e3":{"rev":"c785d47e5bd2","tiles":[0,3,4,5,6,7,8,10,11,12,14,15,16,19]},
    "spot-3fb8e59e3-b":{"rev":"760b3e167f69","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-41089f741":{"rev":"8e1833296fca","tiles":[10]},
    "spot-41089f741-b":{"rev":"000e1f803cf8","tiles":[0,1,2,3,4,5,6,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28]},
    "spot-4238daf29":{"rev":"988d0f0b54b1","tiles":[0,2,4,5,6,7,8,9,10,11,12,13,14,15,17,18]},
    "spot-4238daf29-b":{"rev":"9ce5ea3f7159","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-4398c48a7":{"rev":"717ad5046dbd","tiles":[9,11,15]},
    "spot-4398c48a7-b":{"rev":"3715ae7617c3","tiles":[0,1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-46fc6bef6":{"rev":"dd6e20b2d088","tiles":[2,5,6,7,8,9,10,11,12,13,14,15,19]},
    "spot-46fc6bef6-b":{"rev":"f3523d55905a","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-4732296ba":{"rev":"17fc09d053e4","tiles":[12,13,14]},
    "spot-4732296ba-b":{"rev":"e96a8c10ca62","tiles":[9,12,17,21,27,29]},
    "spot-48ff7da1d":{"rev":"fad02c1f62e6","tiles":[4,5,8,12,16]},
    "spot-48ff7da1d-b":{"rev":"df8f5d4675cb","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,21,26,27,29]},
    "spot-495afce62":{"rev":"0f11bee40ad2","tiles":[0,3,4,5,6,7,8,10,11,12,14,16,18,19]},
    "spot-495afce62-b":{"rev":"71c55bc944ae","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-49779f027":{"rev":"f42d3d417a05","tiles":[0,2,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19]},
    "spot-49779f027-b":{"rev":"5bca507add54","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-51652ebdc":{"rev":"adf2df6853ff","tiles":[9,13]},
    "spot-51652ebdc-b":{"rev":"bf53ba52ca8f","tiles":[5,6]},
    "spot-54f5ce43e":{"rev":"7b3805db985d","tiles":[16]},
    "spot-54f5ce43e-b":{"rev":"3f2d579bfd5c","tiles":[1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,18,19,20,22,23,25,26,27,28,29]},
    "spot-569b08bba":{"rev":"081b3124469c","tiles":[4,5,7,8,10,12,14]},
    "spot-569b08bba-b":{"rev":"97df845a9e5d","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-5724c004b":{"rev":"4fd670cd81f4","tiles":[0,3,4,6,7,8,9,10,11,12,13,14,15,16,17,19]},
    "spot-5724c004b-b":{"rev":"a2d0ec36a719","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-59c3d0ebd":{"rev":"7378981aaaaa","tiles":[2,9,11,13,15,17]},
    "spot-59c3d0ebd-b":{"rev":"ffdad2389422","tiles":[0,1,2,3,4,7,9,10,12,13,15,16,18,19,20,22,24,26,28]},
    "spot-5df3b4a31":{"rev":"99a3dba5bf36","tiles":[4]},
    "spot-5df3b4a31-b":{"rev":"15e311bc3b02","tiles":[0,2,4]},
    "spot-627afeabe":{"rev":"852212a79865","tiles":[0,3,4,6,7,8,10,11,12,13,14,16,19]},
    "spot-627afeabe-b":{"rev":"83191e3b0fba","tiles":[0,2,3,4,5,6,7,9,10,11,13,14,15,16,17,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-628c4952e":{"rev":"b41c8cc7518c","tiles":[4,6,7,8,9,10,11,12,13,15]},
    "spot-628c4952e-b":{"rev":"4dc1e7e84dc5","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-66c6acb84":{"rev":"624503027c3e","tiles":[0,2,4,5,6,7,8,10,12,13,14,16]},
    "spot-66c6acb84-b":{"rev":"1edd69ccd144","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-697bbef9b":{"rev":"ffd99d9396d7","tiles":[0,1,2,3,4,5,6,8,9,12,13,16,17,18,19]},
    "spot-697bbef9b-b":{"rev":"ade68f67054d","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-78367cc4f":{"rev":"338311576cd1","tiles":[13,15]},
    "spot-78367cc4f-b":{"rev":"0caceddfac3c","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-7955326ed":{"rev":"ac97bb5fb9e6","tiles":[0,2,3,4,5,6,7,8,10,12,14,15,16,17]},
    "spot-7955326ed-b":{"rev":"15b155517037","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-79865f593":{"rev":"68a20e51f5c4","tiles":[0,8,9,12,13,16]},
    "spot-79865f593-b":{"rev":"10824445077f","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-7c1b27ec2":{"rev":"a793d4916773","tiles":[4,7]},
    "spot-7c1b27ec2-b":{"rev":"22e7666aa350","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-7fef43934":{"rev":"8d9ca06408b6","tiles":[9,13,18]},
    "spot-7fef43934-b":{"rev":"953d87069e7b","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-83a57353c":{"rev":"e5d2d321ff33","tiles":[7,13]},
    "spot-83a57353c-b":{"rev":"93ddb886dc77","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-86577f3e8":{"rev":"cf23b9d582dc","tiles":[7]},
    "spot-86577f3e8-b":{"rev":"17ebb3186a67","tiles":[0,3,5,6,7,9,10,11,12,17,20,22,23,26,29]},
    "spot-86b29bbb2":{"rev":"be6334feaaa8","tiles":[7,13]},
    "spot-86b29bbb2-b":{"rev":"a7dd03db5fd2","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,14,15,16,17,18,19,20,21,22,23,24,26,28,29]},
    "spot-881d1794c":{"rev":"a6f83018e614","tiles":[13]},
    "spot-881d1794c-b":{"rev":"b547f0c65d83","tiles":[0,1,2,3,4,5,6,8,10,11,12,13,14,15,16,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-885eb86b5":{"rev":"c488ce68dc31","tiles":[13]},
    "spot-885eb86b5-b":{"rev":"1e6e7f0ea093","tiles":[0,3,5,9,11,14,17,19,23,24,25,29]},
    "spot-89ba4f10d":{"rev":"dfea1c50ecc3","tiles":[4,7,12]},
    "spot-89ba4f10d-b":{"rev":"56175543db8e","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,21,22,23,24,25,26,27,28,29]},
    "spot-8f335641b":{"rev":"922d7a63f424","tiles":[7,10,13]},
    "spot-8f335641b-b":{"rev":"601f00569e6a","tiles":[0,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,21,22,23,24,25,26,27,28,29]},
    "spot-90e680279":{"rev":"89c19726ad4c","tiles":[4,6,9,10,11,14,19]},
    "spot-90e680279-b":{"rev":"1ac5eeb26ac6","tiles":[1,2,4,6,7,8,9,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-986c13ff5":{"rev":"ce3ac4cbcc9f","tiles":[0,3,7,9,13,16]},
    "spot-986c13ff5-b":{"rev":"0817c94bd73c","tiles":[0,1,3,4,5,6,7,9,10,11,12,13,14,15,16,17,18,19,22,25,27,29]},
    "spot-9f53c40a2-b":{"rev":"312c910c1c0c","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-a52910691":{"rev":"9fc6c3b9342b","tiles":[0,3,4,6,7,10,13,14,16,19]},
    "spot-a52910691-b":{"rev":"cce64eaeaa0a","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-a7566ef75":{"rev":"bd773f04f1ef","tiles":[0,2,3,4,7,8,11,12,13,14,15,16,18,19]},
    "spot-a7566ef75-b":{"rev":"ab1d13564404","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-ac4485fba":{"rev":"20045b428de9","tiles":[7,13]},
    "spot-ac4485fba-b":{"rev":"8102a0b09c71","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,28,29]},
    "spot-acfec276c-b":{"rev":"258cd4abd0fe","tiles":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-b238fe7ba":{"rev":"34e2069181cf","tiles":[5]},
    "spot-b238fe7ba-b":{"rev":"16182ad9f5f8","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17,18,19,26,27,28,29]},
    "spot-b531cf1e9":{"rev":"89fd0a7e4191","tiles":[4,7,9,11,14]},
    "spot-b531cf1e9-b":{"rev":"24356ec9d293","tiles":[0,1,2,4,7,9,10,12,14,15,16,18,20,22,23,24,25,26,27,28,29]},
    "spot-bbf221799":{"rev":"d18150d38f81","tiles":[13]},
    "spot-bbf221799-b":{"rev":"0938c9dc52f6","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-c01dc34a3":{"rev":"07081ae18302","tiles":[7]},
    "spot-c01dc34a3-b":{"rev":"a546cd37b2eb","tiles":[1,2,4,5,6,9,10,13,14,16,18,19,21,22,24,25,26,27,28]},
    "spot-c1f3498b7":{"rev":"29ede418659d","tiles":[7,13]},
    "spot-c1f3498b7-b":{"rev":"68f0bd124929","tiles":[3,8,9,17,22,29]},
    "spot-c6a0e8931":{"rev":"0d3ecc38a268","tiles":[1,4,8,11,12,17,18]},
    "spot-c6a0e8931-b":{"rev":"2044908a55f8","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,21,22,25,26,27,28,29]},
    "spot-c8601530f":{"rev":"7312cb0824e0","tiles":[5]},
    "spot-c8601530f-b":{"rev":"b697f0ea1c5f","tiles":[0,1,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-cb578c594":{"rev":"41d7fa1190c7","tiles":[7,8,13]},
    "spot-cb578c594-b":{"rev":"df1bcde95f81","tiles":[0,1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-cc31e7e93":{"rev":"8600a27d27de","tiles":[4,5,9,10,12,15]},
    "spot-cc31e7e93-b":{"rev":"db6f46ebb57f","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-ceed47a35":{"rev":"3ae5b499bf04","tiles":[1,7,12,13]},
    "spot-ceed47a35-b":{"rev":"50ac357f3699","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-d1c54f9ac":{"rev":"253961aa68bc","tiles":[4,7,9]},
    "spot-d1c54f9ac-b":{"rev":"012e7a9e55e4","tiles":[0,1,2,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,26,27,28,29]},
    "spot-da027a45c":{"rev":"72c233c72d5c","tiles":[0,3,4,5,6,7,8,10,11,12,13,14,15,16]},
    "spot-da027a45c-b":{"rev":"9b1a8d62e4fd","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,25,26,27,28,29]},
    "spot-df94bb662":{"rev":"11f36ffa0d5c","tiles":[6]},
    "spot-df94bb662-b":{"rev":"01ebfcae7462","tiles":[3,5,6,8,12,13,18,22,27]},
    "spot-e2a5a2ae7":{"rev":"1a46dbc7af78","tiles":[11]},
    "spot-e2a5a2ae7-b":{"rev":"3971beef1a47","tiles":[0,1,3,4,5,7,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,25,26,27,28,29]},
    "spot-e2b4a3c27":{"rev":"32222fb0d2bc","tiles":[0,3,5,7,9,10,12,13,15,16,18]},
    "spot-e2b4a3c27-b":{"rev":"4cbc7c67ac52","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-e3447714a":{"rev":"efe1e24c9597","tiles":[8,11,13]},
    "spot-e3447714a-b":{"rev":"2075d97ef8c3","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,14,16,17,19,20,23,24,25,26,27,28,29]},
    "spot-e4f890e25":{"rev":"02de6256fdd0","tiles":[0,2,3,4,5,6,7,8,9,10,11,12,13,14,16,18,19]},
    "spot-e4f890e25-b":{"rev":"2380bfea87f6","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-e5fd09f2f-b":{"rev":"b2a653349381","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-e67324d3f":{"rev":"26c45c1deca1","tiles":[0,7,12,18,19]},
    "spot-e67324d3f-b":{"rev":"e907df977c35","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-e72214aac":{"rev":"a29c666aca8b","tiles":[2,3]},
    "spot-e72214aac-b":{"rev":"8ecf08e2cb20","tiles":[2,3,8,13,17,20,21,25,29]},
    "spot-edb6dfccc":{"rev":"e8fe0ef39b76","tiles":[0,14,19]},
    "spot-edb6dfccc-b":{"rev":"e11aa82f4ecb","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-eefebbe06":{"rev":"ad9b5aa6f120","tiles":[18]},
    "spot-eefebbe06-b":{"rev":"9dea8f604f1d","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,23,24,25,27,28,29]},
    "spot-efe273a59":{"rev":"474752faafa8","tiles":[9,11,12,13]},
    "spot-efe273a59-b":{"rev":"8ebe2d23de03","tiles":[0,1,2,3,4,5,6,7,8,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-f029df4f6":{"rev":"cc1601e08408","tiles":[4,5,6,7,8,9,11,12,14,19]},
    "spot-f029df4f6-b":{"rev":"cde6d02610c7","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-f3cd60482":{"rev":"bdc2aee579fc","tiles":[7,8]},
    "spot-f3cd60482-b":{"rev":"9974537ce808","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-f3d63d0ed":{"rev":"12979a811e88","tiles":[13,17,18]},
    "spot-f3d63d0ed-b":{"rev":"65ffa673091b","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-f7cce1fae":{"rev":"e0842d997b0f","tiles":[4,7,13]},
    "spot-f7cce1fae-b":{"rev":"43cbba567656","tiles":[3,10,11,17,24,25,29]},
    "spot-fb71239cf":{"rev":"7a71719715e9","tiles":[7,8,13]},
    "spot-fb71239cf-b":{"rev":"fc4b5d4439fa","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,14,15,16,17,18,19,20,21,23,24,25,26,28,29]},
    "tokachi":{"rev":"157a9d7fb85c","tiles":[1,2,7]},
    "tokachi-b":{"rev":"571d05f510e3","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28]},
    "tokyo":{"rev":"6da641a43c64","tiles":[7,11]},
    "tokyo-b":{"rev":"2a250dc023ed","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,29]},
    "tomamu":{"rev":"914c9739a3e3","tiles":[4,14]},
    "tomamu-b":{"rev":"1b20708984e7","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,23,24,25,27,28,29]},
    "toya":{"rev":"28205ef6262d","tiles":[7]},
    "toya-b":{"rev":"ee93b4bbd14e","tiles":[0,1,2,3,4,5,6,7,9,10,12,13,14,15,16,17,18,20,21,22,23,25,26,27,29]},
    "ueno-b":{"rev":"6ef393cc0af4","tiles":[2,3,4,10,12,17,20,22,27]}
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
