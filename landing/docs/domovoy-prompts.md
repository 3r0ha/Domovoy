# Домовой: промпты для Nano Banana

Семь поз плюс лист персонажа. Порядок работы такой: сначала генерируется лист,
он же становится референсом, дальше каждая поза генерируется **с приложенным
листом**, иначе борода, рубаха и пропорции поплывут от кадра к кадру.

Каждый кадр это стикер: одинокая фигура на чистом белом фоне, с тонким контуром,
чтобы фон потом снимался в один клик.

## Что важно выдержать

- фон чисто белый `#FFFFFF`, ровный, без теней, виньеток и градиентов;
- фигура обведена тонкой линией графитового цвета: иначе светлая рубаха сольётся
  с фоном при вырезании;
- кадр квадратный 1:1, персонаж целиком, поля примерно десятая часть стороны;
- все файлы одного размера, 1024×1024;
- палитра ровно четыре цвета: тёплый белый `#F7F3EC`, красный `#C1161C`,
  тёмно-красный `#8E0F14`, графит `#16151A`;
- силуэт должен читаться в 130 пикселей: крупные формы, минимум мелких деталей;
- никакого текста, подписей и логотипов внутри картинки.

## Общий стилевой блок

Этот кусок вставляется в каждый промпт без изменений.

```
STYLE: minimal flat vector sticker illustration. Clean geometric shapes, thin
charcoal contour line around the figure, no gradients, no cast shadows, no 3D,
no texture noise. Strictly limited palette: warm off-white #F7F3EC, crimson red
#C1161C, deep red #8E0F14, charcoal #16151A. Folk feel of Russian embroidery,
but restrained and modern, suitable for a minimal white product website.

CHARACTER: a domovoy, the Slavic house spirit. Short and stocky, roughly four heads
tall, warm and benevolent, never scary and never cutesy. Thick grey beard down to
the belt, bushy eyebrows, small kind eyes, broad round nose, bare feet. He wears a
traditional Slavic linen shirt (kosovorotka) down to the knees in warm off-white,
with red vyaz embroidery, bands of diamonds, rhombs with hooks and meanders,
along the collar, the cuffs and the hem. A twisted crimson sash belt with short
tassels. Charcoal trousers.

OUTPUT: a single isolated sticker on a pure white #FFFFFF background, nothing else
in the frame. Square 1:1 composition, 1024x1024, full body inside the frame with
about 10% padding, character centred, even flat lighting. No background scenery,
no floor, no shadow under the feet, no white outer sticker border, no text, no logo,
no signature.
```

---

## 1. Лист персонажа (референс, на сайт не идёт)

```
[Общий стилевой блок]

COMPOSITION: character reference sheet on a pure white background. Three views of the
same domovoy standing at rest, evenly spaced in one row: front view, three-quarter
view, side view. Identical proportions, identical costume, identical beard length.
Neutral standing pose, arms relaxed, even lighting, no perspective distortion.
```

**Имя файла:** `domovoy-sheet.png`
Кладётся в `landing/docs/`, на сайте не используется. Это референс, который вы
прикладываете ко всем следующим генерациям.

---

## 2. Встречает, главный кадр первого экрана

```
[Общий стилевой блок]

POSE: the domovoy stands facing the viewer with a slight welcoming bow, head tilted
a little. In his right hand a small brass oil lantern with a warm glow, held at hip
height. Left hand open in a greeting gesture, palm turned up. Calm, hospitable
expression, a hint of a smile under the beard. Only the character and the lantern.
```

**Имя файла:** `greeting.png`
Первый экран главной, справа от заголовка. Самый крупный кадр на сайте, деталей
можно чуть больше, чем в остальных.

---

## 3. Слушает, раздел «Заявка»

```
[Общий стилевой блок]

POSE: the domovoy listens carefully. He cups his right hand behind his ear, head
tilted towards the viewer, eyes half closed in concentration, eyebrows raised. Left
hand rests on the sash belt. Slight forward lean, as if catching a distant sound
through a wall. No props except the costume.
```

**Имя файла:** `listening.png`
Страница «Заявка»: домовой разбирает, что написал жилец.

---

## 4. Обходит дом, раздел «Дом»

```
[Общий стилевой блок]

POSE: the domovoy walks in profile from left to right, mid-step, purposeful gait. He
carries the lit oil lantern raised in his left hand and an iron key ring with three
large keys in his right. His head is turned upward, inspecting something above him.
The shirt hem and the beard show slight motion.
```

**Имя файла:** `walking.png`
Страница «Дом»: обход, осмотры, оборудование.

---

## 5. Стучится к соседу сверху, раздел «Соседи»

```
[Общий стилевой блок]

POSE: the domovoy reaches upward and knocks on an unseen ceiling with the knuckles of
his right hand, arm fully extended above his head, standing on tiptoe. In his left
hand a small wooden bucket hangs low. He looks up, mouth slightly open as if calling
out. The body is stretched vertically so the pose reads as knocking from below.
Do not draw the ceiling, only the character.
```

**Имя файла:** `knocking.png`
Страница «Соседи»: стук к соседу сверху при заливе.

---

## 6. Со свитком, раздел «Собрание»

```
[Общий стилевой блок]

POSE: the domovoy holds an unrolled parchment scroll with both hands, wide enough to
cover his chest, reading it with a serious official expression. A round red wax seal
hangs from the lower edge of the scroll on a short cord. The scroll is warm off-white
with a few plain horizontal lines suggesting text, no readable letters. The beard
spills over the top edge of the scroll.
```

**Имя файла:** `scroll.png`
Страница «Собрание»: протокол и кворум.

---

## 7. Тревога, тёмная врезка про жилинспекцию

```
[Общий стилевой блок]

POSE: the domovoy has jumped up in alarm. Beard and eyebrows bristling upward, eyes
wide and round, mouth open. He holds the oil lantern high above his head in his right
hand with a visible warm glow around it; the left hand is clenched into a fist at his
side. Feet apart, body leaning forward, full of urgency.

IMPORTANT: this sticker will later be placed on a near-black background. Keep the
shirt bright warm off-white so the silhouette reads against dark, and do not use
charcoal for large areas of the costume. The frame background still stays pure white.
```

**Имя файла:** `alarmed.png`
Тёмная секция главной, рядом со скриншотом обращения в жилищную инспекцию.
Единственный кадр, который живёт на чёрном, поэтому у него своё требование к
светлоте.

---

## 8. Спит, финальный блок

```
[Общий стилевой блок]

POSE: the domovoy sleeps curled up on his side, knees drawn up, hands tucked under
his cheek. A soft pointed cap is pulled down over his eyes. The unlit lantern stands
beside him. Peaceful, rounded, compact silhouette. Only the character and the
lantern, no stove, no floor, no bedding.
```

**Имя файла:** `sleeping.png`
Финальный блок главной, мелкий кадр. Здесь особенно важен простой силуэт:
в 130 пикселей детали всё равно пропадут.

---

---

# Домовой в мини-приложении

Это другая задача: там маскот работает иконкой размером 44 и 96 пикселей, а не
иллюстрацией во весь экран. Отдельные кадры нужны, потому что ростовая фигура в
44 пикселя превращается в пятно.

Где используется:

- **состояние дома** на главном экране жильца, 44 px: спит (всё в срок), обходит
  (есть просрочка), тревога (авария);
- **пустые состояния** списков, 96 px: те же три настроения;
- **фонарь** вместо спиннера загрузки, 20 px, покачивается на подвесе.

Требования жёстче, чем на лендинге:

- квадрат 1:1, 1024×1024, фигура вписана в круг, крупная голова, короткое тело;
- деталей минимум: узнаваться должны борода, красный пояс и вышивка одной полосой;
- линии толще, чем в ростовых кадрах, иначе в 44 px всё слипнется;
- приложение бывает и светлым, и тёмным, поэтому больших пятен чистого белого и
  чистого чёрного быть не должно: контур тёмно-красный, рубаха тёплая светлая,
  штаны не чернее графита;
- фон кадра всё так же чисто белый, вырезается потом.

## Общий стилевой блок для приложения

```
STYLE: minimal flat vector icon sticker. Compact bust-length character inscribed in a
circular silhouette, oversized head, short body, thick clean shapes, thin dark red
contour, no gradients, no shadows, no 3D, no texture. Strictly limited palette:
warm off-white #F7F3EC, crimson red #C1161C, deep red #8E0F14, charcoal #16151A.
Designed to stay readable at 44 pixels: no small details, no thin strokes.

CHARACTER: a domovoy, the Slavic house spirit. Thick grey beard, bushy eyebrows,
small kind eyes, broad round nose. Traditional Slavic linen shirt in warm off-white
with a single clear band of red vyaz embroidery at the collar. Crimson sash belt.

OUTPUT: a single isolated icon on a pure white #FFFFFF background, square 1:1,
1024x1024, character centred with about 12% padding, even flat lighting. No scenery, no floor,
no shadow, no text, no logo, no outer sticker border.
```

## П1. Спит, в доме всё в срок

```
[Общий стилевой блок для приложения]

POSE: the domovoy dozes sitting, head resting on his own shoulder, eyes closed as two
calm curved lines, soft pointed cap slipped over one eye. Hands folded on his belly.
Relaxed, rounded, compact silhouette.
```

**Имя файла:** `app-sleeping.png`

## П2. Обходит дом, есть просрочка

```
[Общий стилевой блок для приложения]

POSE: the domovoy is on watch. Head turned three-quarters to the side, eyes open and
attentive, one eyebrow raised. He holds a small lit oil lantern up beside his face in
his right hand. Body slightly turned, as if walking past. Alert but calm.
```

**Имя файла:** `app-walking.png`

## П3. Тревога, авария в доме

```
[Общий стилевой блок для приложения]

POSE: the domovoy is alarmed. Beard and eyebrows bristling upward, eyes wide and
round, mouth open in a shout. Both hands raised beside his head. The silhouette stays
inside the same circle as the other two icons.
```

**Имя файла:** `app-alarmed.png`

## П4. Фонарь, вместо спиннера загрузки

```
[Общий стилевой блок для приложения, без блока CHARACTER]

OBJECT: a small brass oil lantern seen from the front, no character. Simple geometric
body: a ring handle on top exactly in the middle of the frame, a tapered top cap, a
glass chamber with a warm crimson flame inside, a flat base. Symmetrical along the
vertical axis. Thick shapes, readable at 20 pixels.

IMPORTANT: the handle ring must sit at the very top centre of the square, because the
icon swings around that point.
```

**Имя файла:** `app-lantern.png`

Файлы приложения кладутся в `apps/miniapp/public/domovoy/` (папку нужно создать),
после чего я переключу `apps/miniapp/src/screens/Domovoy.tsx` с пунктирных заглушек
на картинки.

---

## Куда класть и как подключить

Готовые файлы лендинга, уже без белого фона, кладутся в `landing/public/domovoy/`:

```
landing/public/domovoy/greeting.png
landing/public/domovoy/listening.png
landing/public/domovoy/walking.png
landing/public/domovoy/knocking.png
landing/public/domovoy/scroll.png
landing/public/domovoy/alarmed.png
landing/public/domovoy/sleeping.png
```

Дальше в `landing/src/components/Domovoy.tsx` тело компонента меняется на картинку:
вместо пунктирной заглушки ставится `<img src={`/domovoy/${mood}.png`} …>`, размеры
и места остаются прежними. Скажите, когда файлы будут на месте, и я переключу.

## Что проверить перед вёрсткой

- фон ровно белый по всему кадру, без сероватых разводов у краёв: иначе после
  удаления фона останется грязная кайма;
- контур фигуры замкнут, нигде не прерывается;
- все кадры квадратные и одного размера, иначе в вёрстке домовые поедут;
- у всех семи одинаковая высота персонажа относительно кадра, иначе на странице
  домовые будут разного роста;
- борода, рубаха и пояс совпадают между кадрами;
- в палитре не завелись лишние цвета, особенно синий и коричневый;
- `alarmed` читается на чёрном, `sleeping` читается в мелком размере;
- вышивка на рубахе не превратилась в кашу: лучше меньше стежков, но чётких.

---

# Добавка: чего не хватило в вёрстке

Три раздела остались без маскота, а спящий оказался неудобным: он лежит поперёк
кадра, и рядом с заголовком приходится уменьшать его вдвое. Ниже промпты на замену
и на недостающие позы. Стилевой блок берётся тот же, что и для лендинга (стикер на
белом, квадрат 1024×1024), и лист персонажа так же прикладывается референсом.

## Д1. Заводит часы, раздел «По часам»

```
[Общий стилевой блок]

POSE: the domovoy winds an old wall clock. He stands on tiptoe in three-quarter view,
right hand turning the key of a round pendulum clock that hangs at his shoulder
height, left hand steadying its case. He looks at the clock face with a businesslike
expression. The clock is small and simple: round face, two hands, short pendulum,
warm off-white dial with a red rim. No numbers on the dial.
```

**Имя файла:** `clock.png`
Страница «По часам»: то, что продукт делает по расписанию.

## Д2. Со счётами, раздел «Деньги»

```
[Общий стилевой блок]

POSE: the domovoy stands upright holding a wooden abacus (Russian schoty) in his left
hand at chest height, flicking a bead with the index finger of his right hand. He
looks down at the beads, brows lowered in concentration, lips slightly pursed. The
abacus is compact: a plain frame with three rows of round beads, red and off-white.
```

**Имя файла:** `abacus.png`
Страница «Деньги»: квитанция, показания, пени.

## Д3. С журналом, раздел «Числа»

```
[Общий стилевой блок]

POSE: the domovoy holds an open ledger book against his forearm and runs a finger
down the page, checking a column of entries. Head bowed to the page, eyebrows raised,
calm and attentive. The book is thick with a plain dark red cover; the page shows a
few blank ruled lines, no readable text and no numbers.
```

**Имя файла:** `ledger.png`
Страница «Числа»: сводка, сравнение с прошлым месяцем, журнал действий.

## Д4. Дремлет сидя, замена лежачему

```
[Общий стилевой блок]

POSE: the domovoy dozes sitting on a low wooden bench, back against the wall, arms
folded on his belly, chin dropped to his chest, eyes closed as two calm curved lines.
A soft pointed cap has slipped over one eye. The unlit lantern stands on the floor by
his bare feet. The whole figure stays upright and compact, taller than wide.

IMPORTANT: the silhouette must be vertical, roughly 2:3 within the square, so it fits
the same narrow slot as the standing poses.
```

**Имя файла:** `sleeping.png` (заменяет нынешний лежачий; старый можно оставить как
`sleeping-lying.png`, он пригодится там, где места по ширине много)
Финал главной и всё, где домовой отдыхает.

## Что проверить у этих четырёх

- рост персонажа совпадает с уже готовыми: рядом на странице они стоят парами;
- предметы (часы, счёты, книга) не крупнее головы, иначе в 170 пикселей от домового
  останется один предмет;
- у лежачей замены силуэт вертикальный, иначе смысла в переделке нет.

---

# Добавка вторая: «Смена» и «Чат»

После первой добавки маскот стоит на восьми разделах из десяти. Без него остались
«Смена» (работа диспетчера и мастера) и «Чат» (бот в переписке).

## Д5. С инструментом, раздел «Смена»

```
[Общий стилевой блок]

POSE: the domovoy is on the job. He stands three-quarters to the viewer, a large iron
wrench resting on his right shoulder like a tool of the trade, a folded work order,
a small sheet of paper, held in his left hand at chest height. He glances at the
sheet, businesslike and unhurried. Sleeves rolled up to the elbows.
```

**Имя файла:** `wrench.png`
Страница «Смена»: очередь диспетчера, наряды, выезд мастера.

## Д6. С письмом, раздел «Чат»

```
[Общий стилевой блок]

POSE: the domovoy hands over a letter. He stands facing the viewer and holds out a
small folded paper note with a red wax seal in his right hand, arm extended towards
the viewer as if passing it on. Left hand behind his back. Friendly, slightly
conspiratorial expression, one eyebrow raised.

IMPORTANT: this is a letter, not the scroll from the meeting page, small, folded,
held in one hand, clearly a different object.
```

**Имя файла:** `letter.png`
Страница «Чат»: заявка одним сообщением, кнопки под уведомлением, чат дома.
