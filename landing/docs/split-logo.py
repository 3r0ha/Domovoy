"""Готовит логотип к отрисовке кистью.

Узор не обводится линией и потом заливается: рисует его кисть толщиной с сам
штрих, а видно при этом настоящую заливку. Файл собирается так: маска, в которой
каждая фигура закрашивается змейкой (это и есть след кисти), и под ней обычная
заливка теми же фигурами, где просветы букв сохранены.

Кисть ходит не по контуру, а внутри фигуры: строки змейки ложатся поперёк неё с
шагом уже кисти, поэтому непрокрашенной середины не остаётся. След обрезан по
самой фигуре, так что ни перелёты, ни толщина кисти не задевают соседей.

Фигура пишется целиком и своим путём. `pathLength` приводит фигуры к общей
мерке, а время каждой считается по длине её змейки, поэтому скорость кисти
всюду одна.

Ходов несколько, и они идут разом: надпись пишется слева направо, венец, подвес
и боковые ромбы расходятся от середины к краям.

Вязь собирается иначе, своим ходом. Заливки под кистью там нет: узор и есть след
кисти, а маска это сам узор, и она держит кисть в его границах. Змейка идёт не
поперёк фигуры, а столбцами от середины полосы наружу, поэтому вязь раскрывается
волной в обе стороны; правая половина это отражение левой, кадр в кадр.
"""

from __future__ import annotations

import re
import sys

SOURCE = 'docs/bezslavie-logo-source.svg'
LOGO = 'public/bezslavie-logo.svg'
# Марка для шапки и значка вкладки: та же заливка, но без кисти и её обвязки.
MARK = 'public/bezslavie-mark.svg'
WEAVE = 'public/bezslavie-weave.svg'

BOX = (236.0, 137.23, 938.5, 506.11)
# Кадр вязи: нижняя полоса логотипа, та же, что раньше вырезалась фоном.
BAND = 938.5 * 0.172
# Толщина кисти. След обрезан по фигуре, поэтому кисть берут с запасом: она
# должна перекрывать соседние строки змейки, иначе между ними остаётся просвет.
PEN = 16
# Шаг змейки. Уже кисти, чтобы строки сходились без зазора.
STEP = 9
# Заливку спрямляют осторожнее: её видно всегда, а не только во время отрисовки.
FINE = 0.35
# Марку спрямляют грубо: она стоит размером с ноготь, и точность там не видна.
ROUGH_MARK = 2.5
# Вязь спрямляют ещё осторожнее: полоса идёт во всю ширину экрана, и на ней
# заметно расхождение с исходником даже в треть единицы рамки.
EDGE = 0.05
# Насколько штрих вязи выпускают за пролёт: маска подрежет лишнее, зато у косых
# краёв не остаётся непрокрашенных клиньев.
OVER = PEN / 2
# Насколько может разойтись рамка зеркальной пары фигур: узор рисован рукой.
TWIN = 3.0
# Самый короткий мазок вязи. Узкие детали волна проходит мгновенно, и без нижней
# границы они вспыхивали бы целиком.
SNAP = 90
SCALE = 1 / 60
SHIFT = 768

TOKEN = re.compile(r'([MmLlCcZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)')
COUNTS = {'M': 2, 'm': 2, 'L': 2, 'l': 2, 'C': 6, 'c': 6, 'z': 0, 'Z': 0}


def number(value: float) -> str:
    # Десятой доли единицы рамки хватает: на экране это сотые доли пикселя.
    text = f'{value:.1f}'.rstrip('0').rstrip('.')

    return '0' if text in ('', '-0') else text


class Contour:
    def __init__(self, x: float, y: float) -> None:
        self.start = (x, y)
        self.parts: list[str] = []
        self.min_x = self.max_x = x
        self.min_y = self.max_y = y
        # Длина линии: от неё зависит, сколько кисть будет её вести.
        self.length = 0.0
        # Та же линия ломаной: по ней считают змейку. Точность маске не нужна,
        # а пересекать сотни кривых с каждой строкой дорого.
        self.points: list[tuple[float, float]] = [(x, y)]

    def see(self, x: float, y: float) -> None:
        self.min_x = min(self.min_x, x)
        self.max_x = max(self.max_x, x)
        self.min_y = min(self.min_y, y)
        self.max_y = max(self.max_y, y)

    def walk(self, points: list[tuple[float, float]]) -> None:
        """Считает пройденное расстояние по ломаной, приближающей линию."""
        for before, after in zip(points, points[1:]):
            self.length += ((after[0] - before[0]) ** 2 + (after[1] - before[1]) ** 2) ** 0.5

        self.points.extend(points[1:])

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.min_x + self.max_x) / 2, (self.min_y + self.max_y) / 2)

    @property
    def area(self) -> float:
        return (self.max_x - self.min_x) * (self.max_y - self.min_y)

    def holds(self, other: 'Contour') -> bool:
        return (
            self is not other
            and self.min_x <= other.min_x
            and self.max_x >= other.max_x
            and self.min_y <= other.min_y
            and self.max_y >= other.max_y
        )

    def loop(self) -> list[tuple[float, float]]:
        """Замкнутая ломаная контура: по ней и режут строки змейки."""
        thin = simplify(self.points, FINE)

        return thin if thin[0] == thin[-1] else thin + [thin[0]]

    def path(self) -> str:
        """Контур заливки: та же линия ломаной, только спрямлённая аккуратно.
        Кривые в исходнике короткие, на экране разницы не видно, а держать
        сотни сегментов в обрезке кисти дорого."""
        thin = simplify(self.points, FINE)
        moves = ' '.join(f'L {number(x)} {number(y)}' for x, y in thin[1:])

        return f'M {number(thin[0][0])} {number(thin[0][1])} {moves} z'.strip()


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Убирает точки, которые ничего не меняют: линия остаётся той же, а считать
    по ней обрезку браузеру в разы дешевле."""
    if len(points) < 3:
        return points

    start, end = points[0], points[-1]
    span_x, span_y = end[0] - start[0], end[1] - start[1]
    span = (span_x**2 + span_y**2) ** 0.5
    worst = 0.0
    at = 0

    for index, (x, y) in enumerate(points[1:-1], start=1):
        if span == 0:
            away = ((x - start[0]) ** 2 + (y - start[1]) ** 2) ** 0.5
        else:
            away = abs(span_y * x - span_x * y + end[0] * start[1] - end[1] * start[0]) / span

        if away > worst:
            worst, at = away, index

    if worst <= tolerance:
        return [start, end]

    return simplify(points[: at + 1], tolerance)[:-1] + simplify(points[at:], tolerance)


def curve(nodes: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Кубическая кривая ломаной: длину иначе не измерить."""
    start, first, second, end = nodes
    points = []

    for step in range(9):
        t = step / 8
        rest = 1 - t

        points.append(
            (
                rest**3 * start[0] + 3 * rest**2 * t * first[0] + 3 * rest * t**2 * second[0] + t**3 * end[0],
                rest**3 * start[1] + 3 * rest**2 * t * first[1] + 3 * rest * t**2 * second[1] + t**3 * end[1],
            )
        )

    return points


def split(data: str) -> list[Contour]:
    """Разбирает исходный путь, переводя его в координаты рамки."""
    contours: list[Contour] = []
    current: Contour | None = None
    command = ''
    numbers: list[float] = []
    at = [0.0, 0.0]

    for letter, digits in TOKEN.findall(data):
        if letter:
            if letter in ('z', 'Z'):
                if current is not None:
                    current.parts.append('z')
                    current.walk([(at[0], at[1]), current.start])
                    at[0], at[1] = current.start

                command = ''
            else:
                command = letter

            numbers = []
            continue

        numbers.append(float(digits))

        if command in ('M', 'm') and len(numbers) == 2:
            if command == 'M':
                at[0] = numbers[0] * SCALE
                at[1] = SHIFT - numbers[1] * SCALE
            else:
                at[0] += numbers[0] * SCALE
                at[1] -= numbers[1] * SCALE

            current = Contour(at[0], at[1])
            contours.append(current)
            numbers = []
            # Повтор координат без буквы читается как линия.
            command = 'l'
            continue

        if command in ('l', 'c') and len(numbers) == COUNTS[command] and current is not None:
            moved = [
                value * SCALE if index % 2 == 0 else -value * SCALE
                for index, value in enumerate(numbers)
            ]

            for index in range(0, len(moved), 2):
                current.see(at[0] + moved[index], at[1] + moved[index + 1])

            begin = (at[0], at[1])

            if command == 'l':
                current.walk([begin, (begin[0] + moved[0], begin[1] + moved[1])])
            else:
                nodes = [begin] + [
                    (begin[0] + moved[index], begin[1] + moved[index + 1])
                    for index in range(0, 6, 2)
                ]
                current.walk(curve(nodes))

            at[0] += moved[-2]
            at[1] += moved[-1]
            current.see(at[0], at[1])
            current.parts.append(command + ' ' + ' '.join(number(value) for value in moved))
            numbers = []

    return contours


def groups(contours: list[Contour]) -> list[list[Contour]]:
    """Собирает контуры в фигуры: просвет живёт в одном пути со своей буквой."""
    roots: dict[int, list[Contour]] = {}
    order = sorted(contours, key=lambda contour: contour.area, reverse=True)

    parent: dict[int, Contour] = {}

    for contour in contours:
        holders = [other for other in order if other.holds(contour)]

        if holders:
            parent[id(contour)] = holders[-1]

    def root(contour: Contour) -> Contour:
        seen = contour

        while id(seen) in parent:
            seen = parent[id(seen)]

        return seen

    for contour in contours:
        roots.setdefault(id(root(contour)), []).append(contour)

    return list(roots.values())


def slice_at(loops: list[list[tuple[float, float]]], level: float, across: bool) -> list[tuple[float, float]]:
    """Куски строки, попавшие внутрь фигуры. Просветы считаются честно: правило
    ненулевого обхода, как у заливки."""
    hits: list[tuple[float, int]] = []

    for loop in loops:
        for before, after in zip(loop, loop[1:]):
            first, second = (before[1], after[1]) if across else (before[0], after[0])

            if first == second or not min(first, second) <= level < max(first, second):
                continue

            share = (level - first) / (second - first)
            side = (before[0], after[0]) if across else (before[1], after[1])

            hits.append((side[0] + (side[1] - side[0]) * share, 1 if second > first else -1))

    hits.sort()
    pieces: list[tuple[float, float]] = []
    wind = 0
    opened = 0.0

    for place, way in hits:
        if wind == 0:
            opened = place

        wind += way

        if wind == 0 and place - opened > 0.1:
            pieces.append((opened, place))

    return pieces


def snake(
    loops: list[list[tuple[float, float]]],
    span: tuple[float, float],
    across: bool,
    forward: bool,
) -> list[tuple[float, float]]:
    """Змейка внутри фигуры: строки поперёк неё, соединённые по краям. Кисть
    идёт по ней и закрашивает фигуру целиком, а не обводит её."""
    low, high = span
    rows = max(1, round((high - low) / STEP))
    levels = [low + (high - low) * (row + 0.5) / rows for row in range(rows)]

    if not forward:
        levels.reverse()

    points: list[tuple[float, float]] = []

    for index, level in enumerate(levels):
        pieces = slice_at(loops, level, across)

        if not pieces:
            continue

        if index % 2:
            pieces = [(end, start) for start, end in reversed(pieces)]

        for start, end in pieces:
            points.append((start, level) if across else (level, start))
            points.append((end, level) if across else (level, end))

    return points


class Shape:
    """Фигура узора: внешний контур и его просветы. Кисть закрашивает фигуру
    целиком, иначе выходит не письмо, а прыжки по узору."""

    def __init__(self, contours: list[Contour]) -> None:
        # Сначала внешний контур, потом просветы: так и рисуют.
        self.contours = sorted(contours, key=lambda contour: contour.area, reverse=True)
        self.min_x = min(contour.min_x for contour in contours)
        self.max_x = max(contour.max_x for contour in contours)
        self.min_y = min(contour.min_y for contour in contours)
        self.max_y = max(contour.max_y for contour in contours)
        # Куда ведут кисть: поперёк длинной стороны, там строк больше и тонкие
        # места не проскакивают между ними.
        self.across = (self.max_y - self.min_y) >= (self.max_x - self.min_x)
        self.forward = True
        self.trail: list[tuple[float, float]] = []
        self.length = 0.0

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.min_x + self.max_x) / 2, (self.min_y + self.max_y) / 2)

    def plan(self, across: bool | None = None, forward: bool = True) -> None:
        """Считает змейку: её длина и задаёт время фигуры."""
        if across is not None:
            self.across = across

        self.forward = forward
        loops = [contour.loop() for contour in self.contours]
        span = (self.min_y, self.max_y) if self.across else (self.min_x, self.max_x)
        self.trail = snake(loops, span, self.across, forward)
        self.length = sum(
            ((after[0] - before[0]) ** 2 + (after[1] - before[1]) ** 2) ** 0.5
            for before, after in zip(self.trail, self.trail[1:])
        )

    def path(self) -> str:
        return ' '.join(contour.path() for contour in self.contours)

    def stroke(self) -> str:
        """Путь под кисть: змейка одним росчерком. Один контур на фигуру, иначе
        пунктир открывал бы все её куски разом."""
        if not self.trail:
            self.plan(self.across, self.forward)

        moves = ' '.join(f'L {number(x)} {number(y)}' for x, y in self.trail[1:])

        return f'M {number(self.trail[0][0])} {number(self.trail[0][1])} {moves}'.strip()


class Run:
    """Ход кисти: фигуры пишутся одна за другой. Каждая своим путём, потому что
    между ними кисть не ведут: след перелёта остался бы на узоре полосой."""

    def __init__(self, shapes: list[Shape]) -> None:
        self.shapes = shapes
        self.length = sum(shape.length for shape in shapes) or 1.0
        self.timing: dict[int, tuple[int, int]] = {}

    def clock(self, seconds: float) -> None:
        """Ход укладывается в общее время: тогда все ходы идут параллельно."""
        speed = self.length / seconds
        at = 0.0

        for shape in self.shapes:
            spent = shape.length / speed

            self.timing[id(shape)] = (round(at * 1000), max(60, round(spent * 1000)))
            at += spent


def tick(value: float) -> str:
    """Сотая доля единицы рамки. Столбцы вязи отсчитывают от середины, и на
    округлении в десятую половины разъезжаются на полшага."""
    text = f'{value:.2f}'.rstrip('0').rstrip('.')

    return '0' if text in ('', '-0') else text


def brink(shape: Shape) -> str:
    """Край фигуры для маски вязи. Полоса идёт во всю ширину экрана, и
    спрямление, незаметное на логотипе, уводит здесь контур на целый пиксель."""
    edge = []

    for contour in shape.contours:
        thin = simplify(contour.points, EDGE)
        moves = ' '.join(f'L {tick(x)} {tick(y)}' for x, y in thin[1:])
        edge.append(f'M {tick(thin[0][0])} {tick(thin[0][1])} {moves} z')

    return ' '.join(edge)


class Strand:
    """Змейка вязи: кисть идёт вниз-вверх по столбцам штриховки и уходит от
    середины к краю. На развилке фигуры змейка обрывается: перелетать между
    ветками кисть не должна, иначе след ляжет поперёк узора."""

    def __init__(self) -> None:
        self.columns: list[tuple[float, tuple[float, float]]] = []

    def add(self, x: float, wide: tuple[float, float]) -> None:
        self.columns.append((x, wide))

    def mirror(self, middle: float) -> 'Strand':
        """Та же змейка с другой стороны. Правую половину не считают заново:
        узор рисован рукой и половины сходятся не до точки, а зеркальный след
        идёт с левым кадр в кадр. Маска по своей фигуре всё равно на месте."""
        twin = Strand()
        twin.columns = [(2 * middle - x, wide) for x, wide in self.columns]

        return twin

    def points(self) -> list[tuple[float, float]]:
        walk = []
        down = True

        for x, (top, bottom) in self.columns:
            walk.extend([(x, top), (x, bottom)] if down else [(x, bottom), (x, top)])
            down = not down

        return walk

    @property
    def reach(self) -> tuple[float, float]:
        """Где змейка начинается и где кончается: по этому волна и ведёт кисть."""
        return (self.columns[0][0], self.columns[-1][0])

    def path(self) -> str:
        walk = self.points()
        moves = ' '.join(f'L {tick(x)} {number(y)}' for x, y in walk[1:])

        return f'M {tick(walk[0][0])} {number(walk[0][1])} {moves}'


def room(spans: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Насколько штрих выпускают за пролёт: до половины кисти, но не дальше
    середины просвета. Запас закрывает косые края, где столбцы не сходятся."""
    wide = []

    for index, (top, bottom) in enumerate(spans):
        up = OVER if index == 0 else min(OVER, (top - spans[index - 1][1]) / 2)
        down = OVER if index + 1 == len(spans) else min(OVER, (spans[index + 1][0] - bottom) / 2)
        wide.append((top - max(0.0, up), bottom + max(0.0, down)))

    return wide


def strands(shape: Shape, columns: list[float]) -> list[Strand]:
    """Разбирает фигуру на змейки. Столбцы идут от середины наружу, соседние
    пролёты сцепляются в одну змейку, а на развилке змейка заканчивается."""
    loops = [contour.loop() for contour in shape.contours]
    made: list[Strand] = []
    live: dict[int, Strand] = {}
    before: list[tuple[float, float]] = []

    for x in columns:
        spans = slice_at(loops, x, False)
        wide = room(spans)
        # Пролёты сцепляются с прежними по перекрытию: каждый берёт себе тот,
        # с которым сходится шире всего. На развилке одна ветка достаётся старой
        # змейке, а вторая начинает свою: перескакивать некуда, они рядом.
        claims = sorted(
            (
                (min(bottom, under) - max(top, over), here, was)
                for here, (top, bottom) in enumerate(spans)
                for was, (over, under) in enumerate(before)
                if min(bottom, under) - max(top, over) > 0
            ),
            reverse=True,
        )
        taken: set[int] = set()
        given: set[int] = set()
        link: dict[int, int] = {}

        for _, here, was in claims:
            if here in taken or was in given:
                continue

            link[here] = was
            taken.add(here)
            given.add(was)

        fresh: dict[int, Strand] = {}

        for here in range(len(spans)):
            keep = live.get(link[here]) if here in link else None

            if keep is None:
                keep = Strand()
                made.append(keep)

            keep.add(x, wide[here])
            fresh[here] = keep

        live = fresh
        before = spans

    return made


class Weave:
    """Полоса вязи. Она не пишется фигура за фигурой, а раскрывается волной от
    середины к краям: столбцы штриховки стоят на общей сетке от середины, время
    змейки считается по её месту в полосе, а правая половина это отражение
    левой. Поэтому половины идут кадр в кадр."""

    def __init__(self, shapes: list[Shape], view: tuple[float, float, float, float]) -> None:
        self.view = view
        self.middle = view[0] + view[2] / 2
        self.parts: list[tuple[Shape, list[Strand]]] = []
        # Считают только левую половину: правая это её отражение.
        halves = {id(shape): strands(shape, self.columns(shape, False)) for shape in shapes}

        for shape in shapes:
            twin = self.twin(shape, shapes)
            found = list(halves[id(shape)])

            if twin is None:
                found += strands(shape, self.columns(shape, True))
            else:
                found += [strand.mirror(self.middle) for strand in halves[id(twin)]]

            if found:
                self.parts.append((shape, found))

    def columns(self, shape: Shape, right: bool) -> list[float]:
        """Столбцы штриховки: сетка отсчитывается от середины полосы и идёт
        наружу. Стороны считают порознь, иначе змейка перешла бы через середину
        и половины разъехались."""
        steps = int(self.view[2] / 2 / STEP) + 2
        away = ((index + 0.5) * STEP for index in range(steps))
        side = (self.middle + step if right else self.middle - step for step in away)

        return [x for x in side if shape.min_x <= x <= shape.max_x]

    def twin(self, shape: Shape, shapes: list[Shape]) -> Shape | None:
        """Зеркальная фигура: та, что стоит на отражённом месте. Середину узор
        держит сам с собой, а у краёв пары находятся по рамке."""
        want = (2 * self.middle - shape.max_x, 2 * self.middle - shape.min_x)

        for other in shapes:
            if abs(other.min_x - want[0]) < TWIN and abs(other.max_x - want[1]) < TWIN:
                return other

        return None

    def clock(self, seconds: float) -> dict[int, tuple[int, int]]:
        """Время каждой змейки. Кисть держится волны: змейка начинается, когда
        волна доходит до её первого столбца, и кончается на последнем. Время
        считается по одним столбцам, а сетка столбцов от середины зеркальна,
        поэтому половины идут кадр в кадр без всякой подгонки."""
        every = [strand for _, found in self.parts for strand in found]
        edge = max(abs(x - self.middle) for strand in every for x in strand.reach) or 1.0
        timing = {}

        for strand in every:
            begin, end = (abs(x - self.middle) / edge * seconds for x in strand.reach)
            timing[id(strand)] = (round(begin * 1000), max(SNAP, round((end - begin) * 1000)))

        return timing

    def document(self, seconds: float) -> str:
        left, top, width, height = self.view
        timing = self.clock(seconds)
        edge = []
        lines = []

        for shape, found in self.parts:
            edge.append(f'<path d="{brink(shape)}"/>')

            for strand in found:
                delay, spent = timing[id(strand)]
                lines.append(
                    f'<path pathLength="1" style="--d:{delay};--t:{spent}" d="{strand.path()}"/>'
                )

        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{number(left)} {number(top)} '
            f'{number(width)} {number(height)}">\n'
            '  <title>БЕЗЪСЛАВИЕ</title>\n'
            '  <!-- Узор здесь и есть след кисти: заливки под ней нет. Маска это сам\n'
            '       узор, она держит кисть в его границах, поэтому край сглажен один\n'
            '       раз и выходит ровно как у обычной заливки. -->\n'
            '  <defs>\n'
            f'    <mask id="pen" maskUnits="userSpaceOnUse" x="{number(left)}" y="{number(top)}" '
            f'width="{number(width)}" height="{number(height)}">\n'
            '      <g fill="#fff" fill-rule="nonzero">\n        '
            + '\n        '.join(edge)
            + '\n      </g>\n'
            '    </mask>\n'
            '  </defs>\n'
            '  <!-- Оба класса на одной группе: рисовать и закрашивать здесь нечему\n'
            '       порознь, а компоненту нужно, кому навесить свою маску. -->\n'
            f'  <g class="ink-pen ink-fill" mask="url(#pen)" fill="none" stroke="#C1161C" '
            f'stroke-width="{PEN}" stroke-linecap="butt" stroke-linejoin="round">\n    '
            + '\n    '.join(lines)
            + '\n'
            '  </g>\n'
            '</svg>\n'
        )


def document(
    view: tuple[float, float, float, float],
    runs: list[Run],
    seconds: float,
    mark: str = 'l',
) -> str:
    """Собирает файл: маска со змейками кисти и под ней обычная заливка.
    `mark` разводит имена обрезок: на странице лежит не один узор."""
    left, top, width, height = view

    for run in runs:
        run.clock(seconds)

    cuts = []
    lines = []
    filled = []
    at = 0
    last = 0

    for run in runs:
        for shape in run.shapes:
            delay, spent = run.timing[id(shape)]
            last = max(last, delay + spent)
            name = f'{mark}{at}'
            at += 1

            cuts.append(f'<clipPath id="{name}c"><use href="#{name}"/></clipPath>')
            lines.append(
                f'<g clip-path="url(#{name}c)"><path pathLength="1" '
                f'style="--d:{delay};--t:{spent}" d="{shape.stroke()}"/></g>'
            )
            filled.append(f'<path id="{name}" d="{shape.path()}"/>')

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{number(left)} {number(top)} '
        f'{number(width)} {number(height)}">\n'
        '  <title>БЕЗЪСЛАВИЕ</title>\n'
        '  <!-- Маску навешивают только на время отрисовки: без неё узор виден целиком. -->\n'
        '  <defs>\n'
        '    <!-- След кисти режут по самой фигуре: тогда ни толщина, ни перелёты\n'
        '         змейки не выходят за её край и не задевают соседей. -->\n    '
        + '\n    '.join(cuts)
        + '\n'
        f'    <mask id="pen" maskUnits="userSpaceOnUse" x="{number(left)}" y="{number(top)}" '
        f'width="{number(width)}" height="{number(height)}">\n'
        f'      <g class="ink-pen" fill="none" stroke="#fff" stroke-width="{PEN}" '
        'stroke-linecap="round" stroke-linejoin="round">\n        '
        + '\n        '.join(lines)
        + '\n'
        '      </g>\n'
        '      <!-- Дописав, маску снимают: иначе её край второй раз сглаживает\n'
        '           контур и узор выходит бледнее эталона. -->\n'
        f'      <rect class="ink-done" style="--d:{last}" x="{number(left)}" y="{number(top)}" '
        f'width="{number(width)}" height="{number(height)}" fill="#fff"/>\n'
        '    </mask>\n'
        '  </defs>\n'
        '  <g class="ink-fill" fill="#C1161C" fill-rule="nonzero">\n    '
        + '\n    '.join(filled)
        + '\n'
        '  </g>\n'
        '</svg>\n'
    )


def main() -> int:
    markup = open(SOURCE, encoding='utf-8').read()
    match = re.search(r'<path d="(.*?)"', markup, re.S)

    if not match:
        print('путь не найден')
        return 1

    contours = split(match.group(1))

    print('контуров:', len(contours), 'фигур:', len(groups(contours)))

    shapes = [Shape(group) for group in groups(contours)]
    middle = BOX[0] + BOX[2] / 2

    # Марка: логотип рисуют только на лендинге, а в шапке и на вкладке нужна
    # обычная картинка, и таскать туда маску с кистью незачем.
    def rough(shape: Shape) -> str:
        parts = []

        for contour in shape.contours:
            thin = simplify(contour.points, ROUGH_MARK)
            moves = ' '.join(f'L {number(x)} {number(y)}' for x, y in thin[1:])

            parts.append(f'M {number(thin[0][0])} {number(thin[0][1])} {moves} z')

        return ' '.join(parts)

    open(MARK, 'w', encoding='utf-8').write(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{number(BOX[0])} {number(BOX[1])} '
        f'{number(BOX[2])} {number(BOX[3])}">\n'
        '  <title>БЕЗЪСЛАВИЕ</title>\n'
        '  <g fill="#C1161C" fill-rule="nonzero">\n    '
        + '\n    '.join(f'<path d="{rough(shape)}"/>' for shape in shapes)
        + '\n  </g>\n</svg>\n'
    )

    def outward(shape: Shape) -> tuple[float, float]:
        return (abs(shape.centre[0] - middle), shape.centre[1])

    def hands(part: list[Shape]) -> list[Run]:
        """Узор симметричен: он раскрывается из середины в обе стороны разом."""
        heart = [shape for shape in part if shape.min_x < middle < shape.max_x]
        left = [shape for shape in part if shape not in heart and shape.centre[0] <= middle]
        right = [shape for shape in part if shape not in heart and shape.centre[0] > middle]

        for shape in heart:
            # Середина расходится в обе стороны разом, значит строки поперёк неё.
            shape.plan(True, True)

        for shape in left:
            # Зеркальная пара идёт зеркально: вдоль x от середины наружу, а
            # сверху вниз одинаково, иначе половины расходятся вразнобой.
            shape.plan(shape.across, shape.across)

        for shape in right:
            shape.plan(shape.across, True)

        return [Run(sorted(side, key=outward)) for side in (heart, left, right) if side]

    # Логотип пишется в несколько рук разом: надпись слева направо, а венец,
    # подвес и боковые ромбы расходятся от середины к краям.
    letters = [
        shape
        for shape in shapes
        if shape.min_y > 300 and shape.max_y < 480 and shape.max_y - shape.min_y > 120
    ]
    crown = [shape for shape in shapes if shape.max_y <= 300]
    hem = [shape for shape in shapes if shape.min_y >= 480]
    # Боковые ромбы стоят в одной полосе с надписью, но это вязь: они расходятся
    # от середины, а не пишутся слева направо.
    sides = [shape for shape in shapes if shape not in letters and shape not in crown and shape not in hem]

    print('надпись:', len(letters), 'венец:', len(crown), 'подвес:', len(hem), 'бока:', len(sides))

    # Буквы пишут сверху вниз, как рукой.
    for shape in letters:
        shape.plan(True, True)

    open(LOGO, 'w', encoding='utf-8').write(
        document(
            BOX,
            [
                Run(sorted(letters, key=lambda shape: shape.min_x)),
                *hands(crown),
                *hands(hem),
                *hands(sides),
            ],
            2.4,
        )
    )

    # Вязь это тот же подвес, взятый отдельной полосой.
    top = BOX[1] + BOX[3] - BAND
    band = [shape for shape in shapes if shape.max_y > top]

    weave = Weave(band, (BOX[0], top, BOX[2], BAND))

    print('в вязи:', len(band), 'змеек:', sum(len(found) for _, found in weave.parts))

    open(WEAVE, 'w', encoding='utf-8').write(weave.document(1.4))

    return 0


sys.exit(main())
