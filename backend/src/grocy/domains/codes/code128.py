"""Pinned TCPDF 1.0.027 automatic Code 128 encoding, translated to Python.

Copyright (C) 2008-2014 Nicola Asuni / Tecnick.com LTD.
SPDX-License-Identifier: LGPL-3.0-or-later
Source: Grocy 4.5.0 packages/interficieis/php-barcode/lib/Barcode1D.php.
"""

import re
from dataclasses import dataclass

from .tables import CODE128_PATTERNS


@dataclass
class _Sequence:
    mode: str
    data: bytes
    shifted: bool = False


def _text_sequences(data: bytes) -> list[_Sequence]:
    sequences = []
    end = 0
    # The pinned expression ends at octal 31, which is decimal 25.
    for match in re.finditer(rb"[\x00-\x19]", data):
        if match.start() > end:
            sequences.append(_Sequence("B", data[end : match.start()]))
        sequences.append(_Sequence("A", match[0]))
        end = match.end()
    if end < len(data) or not sequences:
        sequences.append(_Sequence("B", data[end:]))
    return sequences


def code128(data: bytes) -> list[tuple[bool, int]]:
    sequences: list[_Sequence] = []
    end = 0
    for match in re.finditer(rb"[0-9]{4,}", data):
        if match.start() > end:
            sequences.extend(_text_sequences(data[end : match.start()]))
        length = len(match[0]) - len(match[0]) % 2
        sequences.append(_Sequence("C", data[match.start() : match.start() + length]))
        end = match.start() + length
    if end < len(data) or not sequences:
        sequences.extend(_text_sequences(data[end:]))
    words: list[int] = []
    start = 104
    for index, sequence in enumerate(sequences):
        previous = sequences[index - 1] if index else None
        if sequence.mode == "C":
            if previous is None:
                start = 105
            elif previous.mode != "C":
                words.append(99)
            words.extend(int(sequence.data[i : i + 2]) for i in range(0, len(sequence.data), 2))
            continue
        if previous is None:
            if not sequence.data:
                raise ValueError("Empty Code 128 data")
            if (
                sequence.mode == "B"
                and len(sequence.data) == 1
                and 241 <= sequence.data[0] <= 244
                and len(sequences) > 1
                and sequences[1].mode != "B"
            ):
                start = 103 if sequences[1].mode == "A" else 105
                sequence.mode = sequences[1].mode
                words.append({241: 102, 242: 97, 243: 96, 244: 101}[sequence.data[0]])
                continue
            start = 103 if sequence.mode == "A" else 104
        elif previous.mode != sequence.mode:
            if len(sequence.data) == 1 and previous.mode in ("A", "B") and not previous.shifted:
                words.append(98)
                sequence.shifted = True
            elif not previous.shifted:
                words.append(101 if sequence.mode == "A" else 100)
        for character in sequence.data:
            if 241 <= character <= 244:
                words.append(
                    {241: 102, 242: 97, 243: 96, 244: 101 if sequence.mode == "A" else 100}[
                        character
                    ]
                )
            elif sequence.mode == "A":
                words.append(
                    character - 32
                    if 32 <= character <= 95
                    else character + 64
                    if character <= 31
                    else 0
                )
            else:
                words.append(character - 32 if 32 <= character <= 127 else 0)
    checksum = (start + sum(word * (i + 1) for i, word in enumerate(words))) % 103
    result = []
    for word in [start, *words, checksum, 106, 107]:
        result.extend((i % 2 == 0, int(width)) for i, width in enumerate(CODE128_PATTERNS[word]))
    return result
