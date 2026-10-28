"""Read the isolated editor document as a browser would read its configuration."""

import json
from html.parser import HTMLParser


class EditorDocument(HTMLParser):
    def __init__(self, html: str):
        super().__init__()
        self.options = {}
        self.scripts = []
        self.policy = ""
        self._configuration = False
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "meta" and values.get("http-equiv") == "Content-Security-Policy":
            self.policy = values["content"]
        if tag == "script":
            self.scripts.append(values)
            self._configuration = values.get("type") == "application/json"

    def handle_endtag(self, tag):
        if tag == "script":
            self._configuration = False

    def handle_data(self, data):
        if self._configuration:
            self.options = json.loads(data)
