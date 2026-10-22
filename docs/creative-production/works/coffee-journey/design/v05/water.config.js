window.WATER_STUDY={
  id:'coffee-journey-v05-water',baseMass:200,soluteMass:3,maxAdded:100,defaultAdded:0,particleCount:72,initialMode:'extract',durationMs:7600,
  palette:{paper:'#e8eeea',ink:'#273d36',muted:'#65756d',liquid:'#a86f3a',particle:'#674226',water:'#86b6bd'},
  text:{pageTitle:'水，带走一部分 · 杯中的小实验',canvasLabel:'粉体中的部分物质进入水里；移走粉渣后，添加清水只改变杯中浓度',kicker:'从材料，到液体 / A SMALL TRANSFER',diluteTitle:'再加一点水，<br>什么没有变？',filtered:'粉渣已经移开',solute:'咖啡来源溶解物',total:'饮品总质量',fraction:'杯中溶解物的质量分数',result:'溶解物仍是 {solute} 克。加入清水后，它分布在更多液体里。',assumption:'设定：滤净的 200 克饮品含 3 克咖啡来源可溶物。清水不额外带入这类物质，忽略蒸发、洒出与反应。',caption:'点与颜色用于解释物质关系，大小、速度与色深均为示意。',presets:['原杯','＋50 克','＋100 克']},
  extraction:{enabled:true,steps:[
    {at:0,no:'01 / 浸润',title:'水先走近，<br>再带走一部分。',copy:'水接触咖啡粉，部分可溶物进入液体。粉体仍然留在原处。'},
    {at:.32,no:'02 / 溶出',title:'有些留下，<br>有些进入水里。',copy:'水与咖啡粉接触，部分物质从材料中迁移到液体。画面只解释关系，不计算真实萃取速度。'},
    {at:.76,no:'03 / 滤开',title:'现在，<br>把粉渣留在外面。',copy:'移开粉渣后，这杯饮品已有自己的浓度。接下来添加清水，就可以单独观察稀释。'}
  ]}
};
