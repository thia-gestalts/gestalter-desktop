"""Read and write entry fields as BibTeX text, including TeX grouping and commands."""
import re
import unicodedata

TYPE = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]*")
FIELD = re.compile(r"[a-zA-Z][a-zA-Z0-9_:.+/-]*")
TOKEN = re.compile(r'[^\s"\#%\x27(),={}\\]+')
DIRECTIVES = {"string", "preamble", "comment"}
MONTHS = dict(zip("jan feb mar apr may jun jul aug sep oct nov dec".split(),
                  "January February March April May June July August September October November December".split()))


class Reader:
    def __init__(self, text):
        self.text = text
        self.pos = 0
        self.macros = MONTHS.copy()

    def skip(self):
        while self.pos < len(self.text):
            char = self.text[self.pos]
            if char.isspace():
                self.pos += 1
            elif char == "%":
                end = self.text.find("\n", self.pos)
                self.pos = len(self.text) if end < 0 else end + 1
            else:
                break

    def eat(self, char):
        self.skip()
        if self.text.startswith(char, self.pos):
            self.pos += 1
            return True
        return False

    def expect(self, char):
        if not self.eat(char):
            self.fail(f"expected {char}")

    def fail(self, message):
        line = self.text.count("\n", 0, self.pos) + 1
        raise ValueError(f"BibTeX line {line}: {message}.")

    def token(self, pattern, label):
        self.skip()
        match = pattern.match(self.text, self.pos)
        if not match:
            self.fail(f"expected {label}")
        self.pos = match.end()
        return match[0]

    def literal(self, closer):
        start = self.pos
        depth = 0
        opener = "(" if closer == ")" else "{"
        while self.pos < len(self.text):
            char = self.text[self.pos]
            self.pos += 1
            if char == "\\":
                self.pos += 1
            elif depth == 0 and char == closer:
                return self.text[start:self.pos - 1]
            elif char == opener:
                depth += 1
            elif char == (")" if closer == ")" else "}"):
                if not depth:
                    self.fail("unbalanced braces")
                depth -= 1
        self.fail(f"missing closing {closer}")

    def value(self):
        parts = []
        while True:
            if self.eat("{"):
                parts.append(self.literal("}"))
            elif self.eat('"'):
                parts.append(self.literal('"'))
            else:
                word = self.token(TOKEN, "a field value")
                if word.isascii() and word.isdecimal():
                    parts.append(word)
                elif word.lower() in self.macros:
                    parts.append(self.macros[word.lower()])
                else:
                    self.fail(f"undefined string {word}")
            if not self.eat("#"):
                return "".join(parts)

    def fields(self, closer):
        fields = {}
        while not self.eat(closer):
            name = self.token(FIELD, "a field name").lower()
            self.expect("=")
            if name in fields:
                self.fail(f"repeated field {name}")
            fields[name] = self.value()
            if not self.eat(","):
                self.expect(closer)
                break
        return fields

    def entries(self):
        # BibTeX ignores free text between entries.
        outside = re.compile(r"%[^\n]*|@")
        entries = []
        for match in iter(lambda: outside.search(self.text, self.pos), None):
            self.pos = match.end()
            if match[0] != "@":
                continue
            entry_type = self.token(TYPE, "an entry type").lower()
            if self.eat("{"):
                closer = "}"
            elif self.eat("("):
                closer = ")"
            else:
                self.fail("expected { or (")
            if entry_type == "comment":
                self.literal(closer)
            elif entry_type in {"string", "preamble"}:
                if entry_type == "string":
                    name = self.token(TOKEN, "a string name").lower()
                    self.expect("=")
                    self.macros[name] = self.value()
                else:
                    self.value()
                self.eat(",")
                self.expect(closer)
            else:
                key = self.token(TOKEN, "a citation key")
                if self.eat(","):
                    fields = self.fields(closer)
                else:
                    self.expect(closer)
                    fields = {}
                entries.append({"citationKey": key, "bibtexType": entry_type, "fields": fields})
        if not entries:
            raise ValueError("No BibTeX entries found.")
        return entries


def valid_value(value):
    if not isinstance(value, str):
        return False
    reader = Reader(value + "}")
    try:
        return reader.literal("}") == value
    except ValueError:
        return False


def render(entries):
    lines = ["% Generated by Gestalter Academic Sources", ""]
    for entry in sorted(entries, key=lambda entry: entry["citationKey"].casefold()):
        lines.append(f'@{entry["bibtexType"]}{{{entry["citationKey"]},')
        lines.extend(f"  {name} = {{{value}}}," for name, value in entry["fields"].items())
        lines.extend(["}", ""])
    return "\n".join(lines) + "\n"


# Used only for the artifact display name. Keep the original field for export.
ACCENTS = dict(zip("`'^\"~=.uvHckr", "̧̨̀́̂̈̃̄̇̆̌̋̊"))
LETTERS = {
    "ss": "ß", "ae": "æ", "AE": "Æ", "oe": "œ", "OE": "Œ", "aa": "å",
    "AA": "Å", "o": "ø", "O": "Ø", "l": "ł", "L": "Ł", "i": "ı", "j": "ȷ",
    "textendash": "–", "textemdash": "—", "ldots": "…", "dots": "…",
    "textellipsis": "…", "textbackslash": "\\", "textasciitilde": "~",
    "textasciicircum": "^", "textunderscore": "_",
    "TeX": "TeX", "LaTeX": "LaTeX", "BibTeX": "BibTeX",
}
TITLE_TOKEN = re.compile(
    r"""\\(?:(?P<accent>[`'^"~=.uvHckr])\s*(?:\{(?P<braced>\\?[A-Za-z])\}|(?P<plain>\\?[A-Za-z])(?![A-Za-z]))"""
    r"""|(?P<command>[A-Za-z]+)\s*(?:\{\})?|(?P<escaped>.))|[{}~]|---?"""
)


def display_title(value):
    def replace(match):
        if match["accent"]:
            letter = match["braced"] or match["plain"]
            return letter.lstrip("\\") + ACCENTS[match["accent"]]
        if match["command"]:
            return LETTERS.get(match["command"], "")
        if match["escaped"]:
            char = match["escaped"]
            return " " if char in " \\,:;!" else "" if char == "-" else char
        return {"~": " ", "--": "–", "---": "—"}.get(match[0], "")

    return unicodedata.normalize("NFC", TITLE_TOKEN.sub(replace, value))
