"""The pinned formatted editor for shopping notes."""

from grocy.domains.content_editor import editor_document


def notes_editor(description: str, locale: str) -> str:
    return editor_document(description, locale, label="Notes", channel="grocy-shopping-notes")
