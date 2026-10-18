// أسئلة إنجليزية (مثل أقسام الاختبار الإنجليزية) + مولّد أسئلة الحسابات
(function () {
  const DS = window.DS, U = DS.U;
  DS.QB = DS.QB || [];
  const E = (t, q, a, ex, tr) => DS.QB.push({ t, lang: 'en', q, a, c: 0, ex, tr });

  E('basics', 'What does UAV stand for?', ['Unmanned Aerial Vehicle', 'Universal Air Vehicle', 'Unmanned Aircraft System', 'United Aviation Vehicle'], 'UAV = الطيارة بس.', 'وش يعني اختصار UAV؟');
  E('basics', 'What does UAS stand for?', ['Unmanned Aircraft System', 'Unmanned Aerial Vehicle', 'Universal Aircraft Signal', 'Ultra Air Speed'], 'UAS = النظام كامل.', 'وش يعني اختصار UAS؟');
  E('basics', 'A quadcopter has:', ['4 motors', '2 motors', '6 motors', '8 motors'], 'كواد = 4.', 'الكوادكوبتر فيه:');
  E('basics', 'Which component measures altitude using air pressure?', ['Barometer', 'Gyroscope', 'Compass', 'ESC'], 'الباروميتر يقيس الضغط ومنه الارتفاع.', 'أي جزء يقيس الارتفاع بضغط الهواء؟');
  E('basics', 'Which component tells the drone which direction it is facing?', ['Compass (magnetometer)', 'Barometer', 'Battery', 'Propeller'], 'البوصلة تعرف الاتجاه.', 'أي جزء يعرف وين وجه الدرون؟');
  E('basics', 'What does the ESC do?', ['Controls the speed of each motor', 'Holds the camera steady', 'Measures altitude', 'Receives GPS signals'], 'منظم سرعة المحرك.', 'وش يسوي الـ ESC؟');
  E('basics', 'On a quadcopter, the propellers on diagonally opposite motors spin:', ['In the same direction', 'In opposite directions', 'They do not spin', 'Only one of them spins'], 'المتقابلة بالقطر نفس الاتجاه.', 'المراوح المتقابلة بالقطر تلف:');
  E('basics', 'What is "Telemetry"?', ['Data sent from the drone to the screen (altitude, speed, battery)', 'A camera lens', 'A propeller type', 'The landing gear'], 'تيليميتري = بيانات الطيران.', 'وش هي التيليميتري؟');
  E('basics', 'What does GCS stand for?', ['Ground Control Station', 'GPS Control System', 'General Camera Sensor', 'Gimbal Control Switch'], 'محطة التحكم الأرضية.', 'وش يعني GCS؟');
  E('basics', 'What does "Payload" mean?', ['The equipment the drone carries for the mission', 'The battery charge', 'The flight time', 'The propeller size'], 'الحمولة.', 'وش يعني Payload؟');
  E('basics', 'What does a gimbal do?', ['Keeps the camera steady', 'Charges the battery', 'Controls the motors', 'Sends GPS signals'], 'الجمبل يثبت الكاميرا.', 'وش يسوي الجمبل؟');
  E('basics', 'Which part is the "brain" of the drone?', ['Flight Controller', 'Propeller', 'Landing gear', 'Frame'], 'الفلايت كنترولر.', 'أي جزء هو عقل الدرون؟');

  E('controls', 'Which stick controls altitude in Mode 2?', ['Left stick up/down', 'Right stick up/down', 'Left stick left/right', 'Right stick left/right'], 'اليسار فوق وتحت = الارتفاع.', 'أي عصا تتحكم بالارتفاع في مود 2؟');
  E('controls', 'Which movement turns the drone around its own axis?', ['Yaw', 'Pitch', 'Roll', 'Throttle'], 'ياو = اللف حول النفس.', 'أي حركة تلف الدرون حول نفسه؟');
  E('controls', 'Moving the right stick forward (Mode 2) makes the drone:', ['Fly forward', 'Climb', 'Turn right', 'Descend'], 'بتش لقدام.', 'دفيت العصا اليمين لقدام (مود 2) الدرون:');
  E('controls', 'The drone is facing you (nose-in). You push the right stick to the right. The drone moves to:', ['Your left', 'Your right', 'Toward you', 'Away from you'], 'وجهه لك = معكوس.', 'الدرون وجهه لك ودفيت العصا اليمين يمين. يروح:');
  E('controls', 'Which word describes the drone flying with its nose pointing at you?', ['Nose-in', 'Tail-in', 'Side-on', 'Headless'], 'نوز إن.', 'أي كلمة تعني إن وجه الدرون لك؟');
  E('controls', 'What does "Roll" do?', ['Moves the drone sideways left or right', 'Turns the drone around its axis', 'Moves the drone up and down', 'Stops the motors'], 'رول = الجنب.', 'وش تسوي حركة Roll؟');
  E('controls', 'If you lose orientation, the FIRST thing you should do is:', ['Release the sticks and let the drone hover', 'Push all sticks quickly', 'Turn off the controller', 'Fly higher'], 'وقفه أول (في وضع GPS).', 'إذا تلخبطت في الاتجاه، أول شي تسويه:');

  E('modes', 'What does RTH stand for?', ['Return To Home', 'Run To Height', 'Right Turn Heading', 'Rotate To Hover'], 'الرجوع للبيت.', 'وش يعني RTH؟');
  E('modes', 'Which flight mode holds altitude only and lets the wind push the drone?', ['ATTI mode', 'GPS mode', 'Cine mode', 'Follow Me'], 'أتي يثبت الارتفاع بس.', 'أي نمط يثبت الارتفاع بس والهواء يدفه؟');
  E('modes', 'Which flight mode has NO self-leveling and is the hardest to fly?', ['Acro / Manual mode', 'GPS mode', 'Cine mode', 'Tripod mode'], 'أكرو بدون أي مساعدة.', 'أي نمط ما فيه توازن تلقائي وهو الأصعب؟');
  E('modes', 'In Sport mode:', ['Speed is higher, obstacle sensors are often off, and braking distance is longer', 'All obstacle sensors are always on', 'It is the slowest mode', 'It saves battery'], 'وصف السبورت.', 'في وضع السبورت:');
  E('modes', 'Return To Home does NOT work without:', ['GPS', 'A camera', 'Sport mode', 'A memory card'], 'الرجوع يحتاج GPS ونقطة بيت.', 'الرجوع للبيت ما يشتغل بدون:');
  E('modes', 'Which mode is best for slow, smooth filming in tight spaces?', ['Cine / Tripod mode', 'Sport mode', 'Acro mode', 'ATTI mode'], 'سيني/ترايبود بطيء وناعم.', 'أي نمط أفضل للتصوير البطيء والأماكن الضيقة؟');
  E('modes', 'What is a "Failsafe"?', ['An automatic safety action, like returning home when the link is lost', 'A fast flight mode', 'A camera setting', 'A battery type'], 'نظام الأمان التلقائي.', 'وش هو الـ Failsafe؟');

  E('preflight', 'Before takeoff, you should wait for:', ['Enough GPS satellites and the Home Point recorded', 'A low battery warning', 'Strong wind', 'Sport mode'], 'أقمار كافية ونقطة بيت.', 'قبل الإقلاع المفروض تنتظر:');
  E('preflight', 'The correct power-on order is:', ['Controller first, then the drone', 'Drone first, then the controller', 'Both at the same time', 'It does not matter'], 'الريموت أول.', 'ترتيب التشغيل الصح:');
  E('preflight', 'Where should you calibrate the compass?', ['In an open area away from metal and power lines', 'Next to a car', 'On a metal roof', 'Inside the house'], 'بعيد عن الحديد.', 'وين تسوي معايرة البوصلة؟');
  E('preflight', 'The RTH altitude should be:', ['Higher than the tallest obstacle in the area', 'As low as possible', 'Always 5 meters', 'It does not matter'], 'أعلى من أطول عائق.', 'ارتفاع الرجوع للبيت لازم يكون:');
  E('preflight', 'What is the "Home Point"?', ['The location the drone returns to', 'The highest point of the flight', 'The battery level', 'The camera position'], 'نقطة البيت.', 'وش هي نقطة البيت؟');
  E('preflight', 'When should you update the drone firmware?', ['At home before going to the field', 'During the flight', 'Right before takeoff in the field', 'Never'], 'التحديث في البيت.', 'متى تحدّث برنامج الدرون؟');
  E('preflight', 'After takeoff, you should first:', ['Hover at 2-3 m and check that the drone is stable', 'Fly far away immediately', 'Climb to 100 m', 'Switch to Sport mode'], 'اختبار الثبات.', 'بعد الإقلاع أول شي:');

  E('weather', 'A strong headwind will make your ground speed:', ['Lower', 'Higher', 'The same', 'Zero always'], 'الهواء ضدك ينقص سرعتك على الأرض.', 'الهواء القوي ضدك يخلي سرعتك على الأرض:');
  E('weather', 'All of the following reduce flight time EXCEPT:', ['The color of the drone', 'Cold weather', 'Strong wind', 'Heavy payload'], 'EXCEPT = ما عدا.', 'كل هذول ينقصون وقت الطيران ما عدا:');
  E('weather', 'A swollen (puffy) LiPo battery should:', ['Never be used or charged', 'Be charged slowly', 'Be used one more time', 'Be cooled with water'], 'خطر حريق.', 'البطارية المنفوخة:');
  E('weather', 'Where is the wind usually stronger?', ['At higher altitude', 'Near the ground', 'Inside buildings', 'It is always the same'], 'فوق أقوى.', 'وين الهواء غالباً أقوى؟');
  E('weather', 'When should you start returning home?', ['At about 30% battery', 'At 5% battery', 'When the motors stop', 'When it gets dark'], 'ارجع على 30%.', 'متى تبدأ ترجع للبيت؟');
  E('weather', 'If it starts raining during flight, you should:', ['Return and land immediately', 'Continue the mission', 'Climb above the clouds', 'Switch to Sport mode and keep flying'], 'انزل فوراً.', 'إذا بدأ المطر وأنت طاير:');
  E('weather', 'A "tailwind" is wind that comes from:', ['Behind you', 'In front of you', 'The side', 'Below you'], 'تيل ويند = معك.', 'التيل ويند هو هواء جاي من:');
  E('weather', 'Hot weather usually:', ['Reduces flight time and heats the battery', 'Increases flight time', 'Has no effect', 'Cools the motors'], 'الحر يقلل وقت الطيران.', 'الجو الحار غالباً:');

  E('scenarios', 'What should you do FIRST if you lose GPS signal during flight?', ['Fly manually and correct the drift', 'Press Return To Home', 'Release the sticks and wait', 'Climb higher'], 'بدون GPS ما يوقف ولا يرجع.', 'إذا ضاع الـ GPS وأنت طاير، أول شي:');
  E('scenarios', 'The drone flies in growing circles by itself. This is usually caused by:', ['Compass interference', 'A full battery', 'New propellers', 'A good GPS signal'], 'مشكلة بوصلة (Toilet Bowl).', 'الدرون يدور دوائر تكبر لحاله. السبب غالباً:');
  E('scenarios', 'A manned aircraft is approaching your area. You should:', ['Descend immediately and give way', 'Climb to take photos', 'Continue your mission', 'Hover in its path'], 'الأولوية للطيارة اللي فيها بشر.', 'طيارة فيها ناس تقرب من منطقتك:');
  E('scenarios', 'VRS (Vortex Ring State) happens when the drone:', ['Descends vertically too fast', 'Flies forward fast', 'Hovers in GPS mode', 'Takes off slowly'], 'النزول العمودي السريع.', 'الـ VRS يصير لما الدرون:');
  E('scenarios', 'Obstacle sensors may NOT detect:', ['Thin wires and glass', 'Large walls', 'Big trees', 'Buildings'], 'الأسلاك الرقيقة والزجاج.', 'حساسات العوائق ممكن ما تشوف:');
  E('scenarios', 'Which is the correct emergency priority?', ['Aviate, Navigate, Communicate', 'Communicate, Navigate, Aviate', 'Navigate, Communicate, Aviate', 'Only communicate'], 'طيّر ثم وجّه ثم بلّغ.', 'الترتيب الصح في الطوارئ:');
  E('scenarios', 'If the link between the controller and the drone is lost, you should NOT:', ['Turn the controller off and on', 'Point the antennas toward the drone', 'Watch the map', 'Wait for the automatic return'], 'NOT = دور على الغلط.', 'إذا انقطع الاتصال، وش الشي اللي ما تسويه؟');
  E('scenarios', 'During RTH, a building taller than the RTH altitude is in the way. You should:', ['Cancel RTH and fly over it manually', 'Let the drone continue', 'Turn off the controller', 'Switch to Sport mode'], 'ألغِ الرجوع وارفعه.', 'وقت الرجوع للبيت في طريقه مبنى أعلى منه:');
  E('scenarios', 'A bird of prey attacks your drone. The BEST action is to:', ['Climb quickly and move away', 'Hover and wait', 'Chase the bird', 'Land in water'], 'أغلب الطيور ما تصعد بسرعة الدرون.', 'طير جارح يهاجم الدرون. أفضل تصرف:');
  E('scenarios', 'After a crash, the FIRST thing to do is:', ['Stop the motors', 'Take off again', 'Charge the battery', 'Update the firmware'], 'طفي المحركات فوراً.', 'بعد ما يطيح الدرون، أول شي:');

  E('safety', 'What does VLOS mean?', ['Visual Line Of Sight', 'Very Low Speed', 'Vertical Landing On Site', 'Video Link Of Satellite'], 'قدام عينك.', 'وش معنى VLOS؟');
  E('safety', 'Which of the following is NOT a good practice?', ['Flying over crowds of people', 'Keeping the drone in visual line of sight', 'Checking propellers before flight', 'Landing when the battery is low'], 'الطيران فوق الناس ممنوع.', 'أي واحد مو تصرف صحيح؟');
  E('safety', 'What does BVLOS mean?', ['Beyond Visual Line Of Sight', 'Battery Voltage Low Output Signal', 'Below Visual Level Of Sky', 'Basic Vertical Landing Operation System'], 'أبعد من مدى النظر.', 'وش معنى BVLOS؟');
  E('safety', 'What does "Geofence" mean?', ['A virtual boundary that limits where the drone can fly', 'A metal fence around the airport', 'A type of antenna', 'A landing pad'], 'سور وهمي.', 'وش معنى Geofence؟');
  E('safety', 'What does AGL mean?', ['Above Ground Level', 'Average GPS Level', 'Altitude Gain Limit', 'Air Ground Link'], 'الارتفاع عن الأرض.', 'وش يعني AGL؟');
  E('safety', 'The maximum altitude commonly allowed for small drones in most countries is:', ['120 m (400 ft)', '500 m', '50 ft', '1000 m'], '120 متر = 400 قدم.', 'أعلى ارتفاع مسموح غالباً:');
  E('safety', 'What does FPV stand for?', ['First Person View', 'Fast Propeller Velocity', 'Flight Power Voltage', 'Full Position View'], 'تشوف من كاميرا الدرون.', 'وش يعني FPV؟');
  E('safety', 'Who always has the right of way?', ['Manned aircraft', 'The drone', 'The fastest aircraft', 'The highest aircraft'], 'الطيارات اللي فيها بشر.', 'مين له الأولوية دايماً؟');
  E('safety', 'A "No-Fly Zone" is:', ['An area where flying is not allowed', 'A takeoff area', 'A charging area', 'A training area'], 'منطقة ممنوعة.', 'الـ No-Fly Zone هي:');

  E('military', 'In a lost link situation, a military UAV usually:', ['Follows a pre-programmed lost link procedure', 'Crashes immediately', 'Flies randomly', 'Turns off its engine'], 'إجراء مبرمج قبل المهمة.', 'إذا انقطع اتصال الطيارة العسكرية غالباً:');
  E('military', 'What does ISR stand for?', ['Intelligence, Surveillance, Reconnaissance', 'International Search and Rescue', 'Instant Signal Relay', 'Infrared Sensor Range'], 'استخبارات ومراقبة واستطلاع.', 'وش يعني ISR؟');
  E('military', 'Which camera is best at night?', ['IR / Thermal camera', 'EO daylight camera', 'Zoom camera', 'Action camera'], 'الحرارية.', 'أي كاميرا أفضل بالليل؟');
  E('military', 'What is latency?', ['The delay between your command and its execution', 'The maximum range', 'The battery capacity', 'The flight altitude'], 'التأخير.', 'وش هي الـ Latency؟');
  E('military', 'Satellite communication (SATCOM) allows you to:', ['Control the aircraft beyond radio line of sight', 'Fly only very close', 'Fly only indoors', 'Fly without a crew'], 'أبعد من مدى الراديو.', 'الاتصال بالقمر الصناعي يخليك:');
  E('military', 'Who controls the camera and sensors in a military UAV crew?', ['The Sensor Operator', 'The Pilot', 'The Mechanic', 'The Mission Commander'], 'مشغل الحساسات.', 'مين يتحكم بالكاميرا والحساسات؟');
  E('military', 'What does BDA stand for?', ['Battle Damage Assessment', 'Basic Drone Air', 'Border Defense Area', 'Battery Discharge Alarm'], 'تقييم الضرر.', 'وش يعني BDA؟');
  E('military', 'A loitering munition:', ['Hovers over an area and then dives onto a target', 'Carries passengers', 'Is a type of radar', 'Is a ground vehicle'], 'ذخيرة جوالة.', 'الذخيرة الجوالة:');
  E('military', 'GPS spoofing means:', ['Sending fake satellite signals so the drone thinks it is somewhere else', 'Charging the GPS', 'Updating the map', 'Turning off the radio'], 'خداع بإشارة كذابة.', 'خداع الـ GPS يعني:');
  E('military', 'A "Waypoint" is:', ['A point on the planned route', 'A type of battery', 'A camera mode', 'A weather warning'], 'نقطة بالمسار.', 'الـ Waypoint هي:');

  E('fixedwing', 'A fixed-wing aircraft should take off and land:', ['Into the wind', 'With the wind behind it', 'With a crosswind only', 'It does not matter'], 'ضد الهواء.', 'الطيارة ثابتة الجناح تقلع وتنزل:');
  E('fixedwing', 'What is a stall?', ['Loss of lift because the aircraft is too slow or the nose is too high', 'A very fast dive', 'A broken propeller', 'A lost GPS signal'], 'فقدان الرفع.', 'وش هو الـ Stall؟');
  E('fixedwing', 'To recover from a stall you should:', ['Lower the nose and increase speed', 'Raise the nose more', 'Turn off the engine', 'Make a steep turn'], 'نزل المقدمة وزيد السرعة.', 'عشان تطلع من الـ Stall:');
  E('fixedwing', 'The elevator controls:', ['Pitch (nose up and down)', 'Roll', 'Yaw', 'Engine power'], 'الإليفيتر = Pitch.', 'الإليفيتر يتحكم في:');
  E('fixedwing', 'The ailerons control:', ['Roll', 'Pitch', 'Yaw', 'Flaps'], 'الأيليرون = Roll.', 'الأيليرون يتحكم في:');

  E('english', 'What does "Abort" mean on the radio?', ['Cancel the mission immediately', 'Continue the mission', 'I understand', 'Repeat your message'], 'ألغِ فوراً.', 'وش معنى Abort؟');
  E('english', 'What does "Roger" mean?', ['I received your message', 'Cancel', 'Emergency', 'Say again'], 'وصلتني رسالتك.', 'وش معنى Roger؟');
  E('english', 'What does "Wilco" mean?', ['I understand and will comply', "I can't hear you", 'Wait', 'End of conversation'], 'فهمت وبنفذ.', 'وش معنى Wilco؟');
  E('english', '"Mayday" is used for:', ['A serious emergency (distress call)', 'A normal check', 'A weather report', 'Takeoff clearance'], 'نداء استغاثة.', 'كلمة Mayday تستخدم لـ:');
  E('english', '"Say again" means:', ['Repeat your message', 'I agree', 'Stop now', 'Over and out'], 'عيد كلامك.', 'Say again يعني:');
  E('english', '"Standby" means:', ['Wait', 'Go ahead', 'Land now', 'Return home'], 'انتظر.', 'Standby يعني:');
  E('english', 'What does "Affirmative" mean?', ['Yes', 'No', 'Maybe', 'Repeat'], 'نعم.', 'وش يعني Affirmative؟');
  E('english', 'In the phonetic alphabet, "D" is:', ['Delta', 'David', 'Dog', 'Data'], 'دلتا.', 'حرف D بالأبجدية العسكرية:');
  E('english', 'In the phonetic alphabet, "R" is:', ['Romeo', 'Radio', 'Robert', 'Roger'], 'روميو.', 'حرف R بالأبجدية العسكرية:');
  E('english', 'In the phonetic alphabet, "M" is:', ['Mike', 'Mary', 'Mother', 'Moon'], 'مايك.', 'حرف M بالأبجدية العسكرية:');
  E('english', '"Remaining flight time" means:', ['The time left before the battery runs out', 'The time you already flew', 'The time to charge', 'The time of takeoff'], 'الوقت المتبقي.', 'Remaining flight time يعني:');
  E('english', '"Prohibited" means:', ['Not allowed', 'Recommended', 'Required', 'Allowed'], 'ممنوع.', 'Prohibited يعني:');
  E('english', 'In a question, "EXCEPT" means you should choose the answer that is:', ['Not like the others', 'Correct for all', 'The first step', 'The best'], 'ما عدا.', 'كلمة EXCEPT تعني تختار:');

  // ---------------- مولّد أسئلة الحسابات ----------------
  const R = arr => arr[Math.floor(Math.random() * arr.length)];
  const fx = v => String(Math.round(v * 10) / 10);
  const opts = (right, wrong) => {
    const out = [String(right)], seen = new Set(out);
    for (const w of wrong) { const s = String(w); if (!seen.has(s)) { seen.add(s); out.push(s); } if (out.length === 4) break; }
    const num = parseFloat(right), unit = String(right).replace(/^[-\d.]+/, '');
    for (let k = 1; out.length < 4 && k < 40; k++) {
      const v = isNaN(num) ? null : num + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.abs(num) >= 50 ? 10 : 2);
      const s = v == null ? String(right) + ' (' + k + ')' : String(Math.round(v * 10) / 10) + unit;
      if (!seen.has(s) && (v == null || v >= 0)) { seen.add(s); out.push(s); }
    }
    return out;
  };
  const GEN = [
    () => { const v = R([5, 8, 10, 12, 15, 18, 20, 25]); const en = Math.random() < 0.35;
      return { lang: en ? 'en' : 'ar', q: en ? `The drone speed is ${v} m/s. What is it in km/h?` : `سرعة الدرون ${v} متر بالثانية. كم كيلو بالساعة؟`,
        a: opts(fx(v * 3.6), [fx(v * 3), fx(v * 1.6), fx(v * 36), fx(v / 3.6)]), ex: `نضرب × 3.6: ${v} × 3.6 = ${fx(v * 3.6)}`, tr: en ? `سرعة الدرون ${v} م/ث. كم كم/س؟` : undefined }; },
    () => { const v = R([18, 36, 54, 72, 90]);
      return { lang: 'ar', q: `سرعة ${v} كيلو بالساعة. كم متر بالثانية؟`, a: opts(fx(v / 3.6), [fx(v * 3.6), fx(v / 1.6), fx(v / 3.28)]), ex: `نقسم ÷ 3.6: ${v} ÷ 3.6 = ${fx(v / 3.6)}` }; },
    () => { const h = R([30, 50, 100, 120, 150]); const en = Math.random() < 0.35;
      return { lang: en ? 'en' : 'ar', q: en ? `The drone is at ${h} m. About how many feet is that?` : `الدرون على ارتفاع ${h} متر. كم قدم تقريباً؟`,
        a: opts(String(Math.round(h * 3.28)), [String(Math.round(h * 0.3)), String(h * 10), String(Math.round(h * 1.6))]), ex: `المتر × 3.28: ${h} × 3.28 ≈ ${Math.round(h * 3.28)}`, tr: en ? `الدرون على ${h} متر. كم قدم تقريباً؟` : undefined }; },
    () => { const f = R([100, 200, 400, 500, 1000]);
      return { lang: 'ar', q: `${f} قدم تقريباً كم متر؟`, a: opts(String(Math.round(f / 3.28)), [String(Math.round(f * 3.28)), String(f), String(Math.round(f / 10))]), ex: `القدم ÷ 3.28: ${f} ÷ 3.28 ≈ ${Math.round(f / 3.28)}` }; },
    () => { const h0 = R([0, 30, 45, 90, 120, 180, 200, 270, 300, 330, 350]); const turn = R([20, 45, 90, 180]); const right = Math.random() < 0.5; const en = Math.random() < 0.4;
      const ans = ((h0 + (right ? turn : -turn)) % 360 + 360) % 360, wrong = ((h0 + (right ? -turn : turn)) % 360 + 360) % 360;
      return { lang: en ? 'en' : 'ar', q: en ? `Your heading is ${h0}°. You turn ${right ? 'right' : 'left'} ${turn}°. What is your new heading?` : `اتجاهك ${h0} درجة ولفيت ${right ? 'يمين' : 'يسار'} ${turn} درجة. وش اتجاهك الجديد؟`,
        a: opts(ans, [wrong, (ans + 180) % 360, (h0 + 90) % 360, h0]), ex: `${right ? 'يمين = نزيد' : 'يسار = ننقص'}، وإذا عديت 360 اطرح 360، وإذا نزلت تحت الصفر زيد 360. الجواب ${ans}`, tr: en ? `اتجاهك ${h0}° ولفيت ${right ? 'يمين' : 'يسار'} ${turn}°. وش الاتجاه الجديد؟` : undefined }; },
    () => { const h0 = R([10, 30, 60, 90, 135, 200, 250, 300]); const ans = (h0 + 180) % 360;
      return { lang: 'ar', q: `وش الاتجاه المعاكس لـ ${h0} درجة؟`, a: opts(ans, [(h0 + 90) % 360, (h0 + 270) % 360, 360 - h0 === ans ? (h0 + 45) % 360 : 360 - h0]), ex: `العكس = زيد أو نقص 180: الجواب ${ans}` }; },
    () => { const d = R([2, 3, 4, 5, 6, 8]), v = R([30, 40, 60]); const min = d / v * 60; if (Math.round(min) !== min) return null;
      return { lang: 'ar', q: `البيت يبعد ${d} كيلو والسرعة ${v} كيلو بالساعة. كم دقيقة يحتاج يرجع؟`, a: opts(min, [d * v, Math.round(v / d), min * 2]), ex: `الزمن = المسافة ÷ السرعة = ${d} ÷ ${v} ساعة × 60 = ${min} دقيقة` }; },
    () => { const v = R([5, 8, 10, 12, 15]), t = R([30, 60, 90, 120]); const en = Math.random() < 0.3;
      return { lang: en ? 'en' : 'ar', q: en ? `A drone flies at ${v} m/s for ${t} seconds. How far does it go?` : `درون سرعته ${v} متر بالثانية طار ${t} ثانية. كم مسافة مشى؟`,
        a: opts(v * t + (en ? ' m' : ' متر'), [(v + t) + (en ? ' m' : ' متر'), Math.round(t / v) + (en ? ' m' : ' متر'), (v * t * 10) + (en ? ' m' : ' متر')]), ex: `المسافة = السرعة × الزمن = ${v} × ${t} = ${v * t} متر`, tr: en ? `درون سرعته ${v} م/ث طار ${t} ثانية. كم المسافة؟` : undefined }; },
    () => { const T = R([20, 25, 30, 40]), P = R([40, 50, 60, 80]); const ans = T * P / 100; if (ans !== Math.round(ans)) return null;
      return { lang: 'ar', q: `البطارية الكاملة تكفي ${T} دقيقة. والحين باقي ${P}%. كم دقيقة باقية تقريباً؟`, a: opts(ans, [T - P / 10, P, T]), ex: `${T} × ${P} ÷ 100 = ${ans} دقيقة (وتذكر ترجع قبل ما توصل 30%)` }; },
    () => { const A2 = R([40, 50, 60, 80, 100]), W = R([10, 15, 20, 25]); const head = Math.random() < 0.5; const en = Math.random() < 0.3;
      const ans = head ? A2 - W : A2 + W;
      return { lang: en ? 'en' : 'ar', q: en ? `Your airspeed is ${A2} km/h with a ${W} km/h ${head ? 'headwind' : 'tailwind'}. What is your ground speed?` : `سرعة الطيارة بالهواء ${A2} كيلو بالساعة، والهواء ${head ? 'ضدها' : 'معها'} بسرعة ${W}. كم سرعتها على الأرض؟`,
        a: opts(ans, [head ? A2 + W : A2 - W, A2, W]), ex: head ? `ضدك = نطرح: ${A2} − ${W} = ${ans}` : `معك = نجمع: ${A2} + ${W} = ${ans}`, tr: en ? `سرعتك بالهواء ${A2} والهواء ${head ? 'ضدك' : 'معك'} ${W}. كم سرعتك على الأرض؟` : undefined }; },
    () => { const k = R([10, 20, 30, 40]);
      return { lang: 'ar', q: `سرعة الهواء ${k} عقدة. كم كيلو بالساعة تقريباً؟`, a: opts(fx(k * 1.85), [fx(k * 1.6), fx(k * 3.6), String(k)]), ex: `العقدة × 1.85: ${k} × 1.85 ≈ ${fx(k * 1.85)}` }; },
    () => { const c = R([[12, 'قدامك مباشرة', 'directly ahead'], [3, 'على يمينك', 'to your right'], [6, 'وراك', 'behind you'], [9, 'على يسارك', 'to your left']]);
      const all = ['قدامك مباشرة', 'على يمينك', 'وراك', 'على يسارك'];
      return { lang: 'ar', q: `«طيارة على الساعة ${c[0]}» يعني:`, a: [c[1]].concat(all.filter(x => x !== c[1])), ex: '12 قدام، 3 يمين، 6 ورا، 9 يسار' }; }
  ];
  DS.genCalc = function () {
    for (let i = 0; i < 20; i++) {
      const q = R(GEN)();
      if (q) return Object.assign({ t: 'calc', c: 0, gen: true }, q);
    }
    return null;
  };
})();
