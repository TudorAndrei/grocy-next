"""The pinned TCPDF 1.0.008 Data Matrix encoder, translated to Python.

Copyright (C) 2010-2014 Nicola Asuni / Tecnick.com LTD.
SPDX-License-Identifier: LGPL-3.0-or-later
Source: Grocy 4.5.0 packages/interficieis/php-barcode/lib/Datamatrix.php.
The encoding choices and final-symbol rules retain the reference behavior.
"""

from math import ceil

from .tables import CHARSETS, SYMBOLS

ASCII, C40, TEXT, X12, EDIFACT, BASE256, EXTENDED, DIGITS = range(8)


def _is_mode(character: int, mode: int) -> bool:
    if mode == ASCII:
        return 0 <= character <= 127
    if mode == C40:
        return character == 32 or 48 <= character <= 57 or 65 <= character <= 90
    if mode == TEXT:
        return character == 32 or 48 <= character <= 57 or 97 <= character <= 122
    if mode == X12:
        return character in (13, 42, 62)
    if mode == EDIFACT:
        return 32 <= character <= 94
    if mode == BASE256:
        return character in (232, 233, 234, 241)
    if mode == EXTENDED:
        return 128 <= character <= 255
    return 48 <= character <= 57


def _look_ahead(data: bytes, position: int, mode: int) -> int:
    if position >= len(data):
        return mode
    costs = [0.0, 1.0, 1.0, 1.0, 1.0, 1.25]
    if mode != ASCII:
        costs = [1.0, 2.0, 2.0, 2.0, 2.0, 2.25]
        costs[mode] = 0
    processed = 0
    while True:
        if position + processed == len(data):
            if costs[ASCII] <= ceil(min(costs[1:])):
                return ASCII
            for candidate in (BASE256, EDIFACT, TEXT, X12):
                if costs[candidate] < ceil(
                    min(cost for i, cost in enumerate(costs) if i != candidate)
                ):
                    return candidate
            return C40
        character = data[position + processed]
        processed += 1
        if _is_mode(character, DIGITS):
            costs[ASCII] += 1 / 2
        else:
            costs[ASCII] = ceil(costs[ASCII]) + (2 if _is_mode(character, EXTENDED) else 1)
        for candidate in (C40, TEXT):
            costs[candidate] += (
                2 / 3
                if _is_mode(character, candidate)
                else 8 / 3
                if _is_mode(character, EXTENDED)
                else 4 / 3
            )
        costs[X12] += (
            2 / 3
            if _is_mode(character, X12) or _is_mode(character, C40)
            else 13 / 3
            if _is_mode(character, EXTENDED)
            else 10 / 3
        )
        costs[EDIFACT] += (
            3 / 4
            if _is_mode(character, EDIFACT)
            else 17 / 4
            if _is_mode(character, EXTENDED)
            else 13 / 4
        )
        costs[BASE256] += 4 if _is_mode(character, BASE256) else 1
        if processed < 4:
            continue
        if costs[ASCII] + 1 <= min(costs[1:]):
            return ASCII
        if costs[BASE256] + 1 <= costs[ASCII] or costs[BASE256] + 1 < min(costs[1:5]):
            return BASE256
        for candidate in (EDIFACT, TEXT, X12):
            if costs[candidate] + 1 < min(cost for i, cost in enumerate(costs) if i != candidate):
                return candidate
        if costs[C40] + 1 < min(costs[i] for i in (ASCII, TEXT, EDIFACT, BASE256)):
            if costs[C40] < costs[X12]:
                return C40
            if costs[C40] == costs[X12]:
                for character in data[position + processed + 1 :]:
                    if _is_mode(character, X12):
                        return X12
                    if not _is_mode(character, C40):
                        break
                return C40


def _capacity(count: int) -> int:
    return next((symbol[11] for symbol in SYMBOLS if symbol[11] >= count), 0)


def _randomize(value: int, position: int) -> int:
    return (value + (149 * position) % 255 + 1) % 256


def _switch(mode: int, previous: int) -> int:
    return (
        (124 if previous == EDIFACT else 254)
        if mode == ASCII
        else (0, 230, 239, 238, 240, 231)[mode]
    )


def _high_level(data: bytes) -> tuple[list[int], int]:
    mode = last = ASCII
    position = count = 0
    words: list[int] = []
    while position < len(data):
        last = mode
        if mode == ASCII:
            if position + 1 < len(data) and all(
                _is_mode(c, DIGITS) for c in data[position : position + 2]
            ):
                words.append(int(data[position : position + 2]) + 130)
                count += 1
                position += 2
                continue
            candidate = _look_ahead(data, position, mode)
            if candidate != mode:
                mode = candidate
                words.append(_switch(mode, last))
                count += 1
                continue
            character = data[position]
            position += 1
            if character >= 128:
                words.extend((235, character - 127))
                count += 2
            else:
                words.append(character + 1)
                count += 1
        elif mode in (C40, TEXT, X12):
            pending: list[int] = []
            end = position
            charset = CHARSETS[{C40: "C40", TEXT: "TXT", X12: "X12"}[mode]]
            while True:
                character = data[end]
                end += 1
                if character & 128:
                    if mode == X12:
                        raise ValueError("Invalid X12 character")
                    character &= 127
                    pending.extend((1, 30))
                if character in charset:
                    pending.append(charset[character])
                else:
                    shifts = [(0, "SH1"), (1, "SH2")]
                    if mode in (C40, TEXT):
                        shifts.append((2, "S3C" if mode == C40 else "S3T"))
                    for shift, name in shifts:
                        if character in CHARSETS[name]:
                            pending.extend((shift, CHARSETS[name][character]))
                            break
                    else:
                        raise ValueError("Invalid compact character")
                if len(pending) >= 3:
                    value = 1600 * pending.pop(0) + 40 * pending.pop(0) + pending.pop(0) + 1
                    words.extend((value >> 8, value % 256))
                    count += 2
                    position = end
                    candidate = _look_ahead(data, position, mode)
                    if candidate != mode:
                        mode = candidate
                        if mode != ASCII:
                            words.append(_switch(ASCII, last))
                            count += 1
                        words.append(_switch(mode, last))
                        count += 1
                        position -= len(pending)
                        pending.clear()
                        break
                if not pending or end >= len(data):
                    break
            if pending:
                remaining = _capacity(count) - count
                if remaining in (1, 2) and len(pending) == 1:
                    if remaining == 2:
                        words.append(254)
                        count += 1
                    words.append(character + 1)
                    count += 1
                    position = end
                    mode = last = ASCII
                elif remaining == 2 and len(pending) == 2:
                    value = 1600 * pending[0] + 40 * pending[1] + 1
                    words.extend((value >> 8, value % 256))
                    count += 2
                    position = end
                    mode = last = ASCII
                elif mode != ASCII:
                    mode = last = ASCII
                    words.append(_switch(mode, last))
                    count += 1
                    position = end - len(pending)
        elif mode == EDIFACT:
            pending = []
            end = position
            while True:
                character = data[end]
                if _is_mode(character, EDIFACT):
                    end += 1
                    pending.append(character)
                if len(pending) == 4 or end == len(data) or not _is_mode(character, EDIFACT):
                    if end == len(data) and len(pending) < 3:
                        mode = ASCII
                        words.append(_switch(mode, last))
                        count += 1
                        break
                    if len(pending) < 4:
                        pending.append(31)
                        pending.extend([0] * (4 - len(pending)))
                        mode = last = ASCII
                    values = (
                        ((pending[0] & 63) << 2) + ((pending[1] & 48) >> 4),
                        ((pending[1] & 15) << 4) + ((pending[2] & 60) >> 2),
                        ((pending[2] & 3) << 6) + (pending[3] & 63),
                    )
                    for value in values:
                        if value > 0:
                            words.append(value)
                            count += 1
                    pending.clear()
                    position = end
                    if mode == ASCII:
                        break
                if end >= len(data):
                    break
        else:
            pending = []
            while position < len(data) and len(pending) <= 1555:
                candidate = _look_ahead(data, position, mode)
                if candidate != mode:
                    mode = candidate
                    break
                pending.append(data[position])
                position += 1
            if len(pending) <= 249:
                words.append(_randomize(len(pending), count + 1))
                count += 1
            else:
                words.extend(
                    (
                        _randomize(len(pending) // 250 + 249, count + 1),
                        _randomize(len(pending) % 250, count + 2),
                    )
                )
                count += 2
            words.extend(_randomize(value, count + i + 1) for i, value in enumerate(pending))
    return words, last


def _error_correction(words: list[int], blocks: int, data_size: int, error_size: int) -> list[int]:
    logarithm = [0] * 256
    antilog = [1] * 256
    for i in range(1, 256):
        value = antilog[i - 1] * 2
        if value >= 256:
            value ^= 301
        antilog[i] = value
        logarithm[value] = i

    def product(a: int, b: int) -> int:
        return antilog[(logarithm[a] + logarithm[b]) % 255] if a and b else 0

    coefficients = [1] + [0] * error_size
    for i in range(1, error_size + 1):
        coefficients[i] = coefficients[i - 1]
        for j in range(i - 1, 0, -1):
            coefficients[j] = coefficients[j - 1] ^ product(coefficients[j], antilog[i])
        coefficients[0] = product(coefficients[0], antilog[i])
    total = blocks * data_size
    result = words + [0] * (total + blocks * error_size - len(words))
    for block in range(blocks):
        values = [result[n] for n in range(block, total, blocks)]
        errors = [0] * (error_size + 1)
        for value in values:
            factor = errors[0] ^ value
            for i in range(error_size):
                errors[i] = errors[i + 1] ^ product(factor, coefficients[error_size - i - 1])
        for i in range(error_size):
            result[total + block + i * blocks] = errors[i]
    return result


def _placement(rows: int, cols: int) -> list[int]:
    cells = [0] * (rows * cols)

    def place(points: list[tuple[int, int]], character: int) -> None:
        for bit, (row, col) in enumerate(points, 1):
            if row < 0:
                row += rows
                col += 4 - ((rows + 4) % 8)
            if col < 0:
                col += cols
                row += 4 - ((cols + 4) % 8)
            cells[row * cols + col] = 10 * character + bit

    def utah(row: int, col: int, character: int) -> None:
        place(
            [
                (row - 2, col - 2),
                (row - 2, col - 1),
                (row - 1, col - 2),
                (row - 1, col - 1),
                (row - 1, col),
                (row, col - 2),
                (row, col - 1),
                (row, col),
            ],
            character,
        )

    character, row, col = 1, 4, 0
    while True:
        if row == rows and col == 0:
            place(
                [
                    (rows - 1, 0),
                    (rows - 1, 1),
                    (rows - 1, 2),
                    (0, cols - 2),
                    (0, cols - 1),
                    (1, cols - 1),
                    (2, cols - 1),
                    (3, cols - 1),
                ],
                character,
            )
            character += 1
        if row == rows - 2 and col == 0 and cols % 4:
            place(
                [
                    (rows - 3, 0),
                    (rows - 2, 0),
                    (rows - 1, 0),
                    (0, cols - 4),
                    (0, cols - 3),
                    (0, cols - 2),
                    (0, cols - 1),
                    (1, cols - 1),
                ],
                character,
            )
            character += 1
        if row == rows - 2 and col == 0 and cols % 8 == 4:
            place(
                [
                    (rows - 3, 0),
                    (rows - 2, 0),
                    (rows - 1, 0),
                    (0, cols - 2),
                    (0, cols - 1),
                    (1, cols - 1),
                    (2, cols - 1),
                    (3, cols - 1),
                ],
                character,
            )
            character += 1
        if row == rows + 4 and col == 2 and not cols % 8:
            place(
                [
                    (rows - 1, 0),
                    (rows - 1, cols - 1),
                    (0, cols - 3),
                    (0, cols - 2),
                    (0, cols - 1),
                    (1, cols - 3),
                    (1, cols - 2),
                    (1, cols - 1),
                ],
                character,
            )
            character += 1
        while True:
            if row < rows and col >= 0 and not cells[row * cols + col]:
                utah(row, col, character)
                character += 1
            row -= 2
            col += 2
            if row < 0 or col >= cols:
                break
        row += 1
        col += 3
        while True:
            if row >= 0 and col < cols and not cells[row * cols + col]:
                utah(row, col, character)
                character += 1
            row += 2
            col -= 2
            if row >= rows or col < 0:
                break
        row += 3
        col += 1
        if row >= rows and col >= cols:
            break
    if not cells[-1]:
        cells[-1] = cells[-cols - 2] = 1
    return cells


def datamatrix(data: bytes) -> list[list[int]]:
    words, last = _high_level(data)
    count = len(words)
    if count > 1558 or not data:
        raise ValueError("Data Matrix payload is too large or empty")
    symbol = next(symbol for symbol in SYMBOLS if symbol[11] >= count)
    if symbol[11] > count:
        if symbol[11] - count > 1 and words[-1] != 254:
            if last == EDIFACT:
                words.append(124)
            elif last not in (ASCII, BASE256):
                words.append(254)
        if symbol[11] > len(words):
            words.append(129)
            while len(words) < symbol[11]:
                value = 129 + (149 * len(words)) % 253 + 1
                words.append(value - 254 if value > 254 else value)
    words = _error_correction(words, symbol[13], symbol[14], symbol[15])
    places = iter(_placement(symbol[2], symbol[3]))
    grid = [[0] * symbol[1] for _ in range(symbol[0])]
    for vertical in range(symbol[9]):
        for row in range(symbol[4]):
            for horizontal in range(symbol[8]):
                for col in range(symbol[5]):
                    if row == 0:
                        value = int(col % 2 == 0)
                    elif row == symbol[4] - 1 or col == 0:
                        value = 1
                    elif col == symbol[5] - 1:
                        value = row % 2
                    else:
                        place = next(places)
                        value = (
                            place
                            if place < 2
                            else int(bool(words[place // 10 - 1] & (1 << (8 - place % 10))))
                        )
                    grid[vertical * symbol[4] + row][horizontal * symbol[5] + col] = value
    return grid
