"""M26 sensitive scan: every secret here is fake and built in the test."""

import json

from docx import Document
from fastapi.testclient import TestClient

from objectapp import importscan
from objectapp.importscan import Finding, scan_file, scan_text, scan_tree

PEM = "-----BEGIN RSA " + "PRIVATE KEY-----"
AWS = "AKIA" + "FAKEFAKEFAKEFAKE"
CARD = "4111 1111 1111 1111"  # the well-known test number


def kinds(text):
    return [(f.kind, f.line) for f in scan_text(text)]


def test_kinds_and_lines():
    text = f"ok\n{PEM}\nkey {AWS}\npassword = hunter2hunter\npostgres://u:p4ss@db.local/x\ncard {CARD}\n"
    assert kinds(text) == [
        ("private-key", 2),
        ("api-key", 3),
        ("password", 4),
        ("connection-string", 5),
        ("card-number", 6),
    ]


def test_tokens_formats():
    for t in ["ghp_" + "a" * 36, "xoxb-" + "1" * 12 + "-abc", "sk_live_" + "a" * 20, "sk-ant-" + "a" * 30]:
        assert kinds(f"x {t}") == [("api-key", 1)], t


def test_no_false_positives():
    text = "password: <your password>\npassword = \nThe password policy is strict\nOrder 1234567890123 shipped\nDate 2026-11-06 12:00:00\npostgres://localhost/db\n"
    assert kinds(text) == []


def test_luhn():
    assert kinds("n 4111111111111111") == [("card-number", 1)]
    assert kinds("n 4111111111111112") == []
    assert kinds("n 0000 0000 0000 0000") == []


def test_finding_never_holds_value():
    f = scan_text(f"{AWS}")[0]
    assert set(vars(f)) == {"kind", "line"} and AWS not in repr(f)


def test_scan_file_docx_and_plain(tmp_path):
    d = Document()
    d.add_paragraph("fine")
    d.add_paragraph(f"token {AWS}")
    p = tmp_path / "a.docx"
    d.save(p)
    assert scan_file(p) == [Finding("api-key", 3)]  # a line of the converted page (blank line between paragraphs)
    (tmp_path / ".env").write_text(f"X=1\nDB_PASSWORD=abcd1234\n")
    assert scan_file(tmp_path / ".env") == [Finding("password", 2)]
    (tmp_path / "b.bin").write_bytes(b"\x00\x01" + AWS.encode())
    assert scan_file(tmp_path / "b.bin") == []


def make_tree(tmp_path):
    (tmp_path / "Credentials").mkdir()
    (tmp_path / "Credentials" / "keys.txt").write_text(AWS)
    (tmp_path / "Notes").mkdir()
    (tmp_path / "Notes" / "ok.md").write_text("hello")
    (tmp_path / "Notes" / "bad.md").write_text(f"a\n{CARD}\n")
    (tmp_path / "secrets.local.txt").write_text(AWS)
    return tmp_path


def test_scan_tree_leave_out_never_read(tmp_path, monkeypatch):
    root = make_tree(tmp_path)
    opened = []
    real = importscan._text_of
    monkeypatch.setattr(importscan, "_text_of", lambda p: (opened.append(p.name), real(p))[1])
    rep = scan_tree(root, ["credentials", "*.local.txt"])
    assert sorted(rep.left_out) == ["Credentials/keys.txt", "secrets.local.txt"]
    assert "keys.txt" not in opened and "secrets.local.txt" not in opened
    assert rep.findings == {"Notes/bad.md": [Finding("card-number", 2)]}
    assert rep.counts == {"scanned": 2, "unscanned": 0, "flagged": 1, "findings": 1, "leftOut": 2}


def test_route(tmp_path, client_factory=None):
    from objectapp.api_importscan import router
    from fastapi import FastAPI

    root = make_tree(tmp_path / "src") if (tmp_path / "src").mkdir() is None else None
    app = FastAPI()
    app.include_router(router(None), prefix="/api")
    c = TestClient(app)
    before = sorted(p.name for p in root.rglob("*"))
    r = c.post("/api/import/scan", json={"path": str(root), "leaveOut": ["Credentials"]})
    assert r.status_code == 200
    body = r.json()
    assert body["findings"]["Notes/bad.md"] == [{"kind": "card-number", "line": 2}]
    assert body["leftOut"] == ["Credentials/keys.txt"] or "Credentials/keys.txt" in body["leftOut"]
    assert body["defaultChoice"] == "excludeFromAi"
    assert AWS not in json.dumps(body) and "4111" not in json.dumps(body)
    assert before == sorted(p.name for p in root.rglob("*"))
    missing = c.post("/api/import/scan", json={"path": str(tmp_path / "nope"), "leaveOut": []})
    assert missing.status_code == 404
    # The same error shape as every other route (the UI's error reader shows `detail`).
    assert missing.json() == {"detail": "There is no file or folder at this path."}
    # A relative path is not the server's working folder.
    assert c.post("/api/import/scan", json={"path": ".", "leaveOut": []}).status_code == 404


def test_mounted_in_server():
    import inspect
    from objectapp import server

    assert "api_importscan.router(ctx)" in inspect.getsource(server)
