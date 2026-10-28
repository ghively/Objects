from h import *
from objectapp.media import import_attachment, attachment_path, list_attachments, import_image
s, d = space()
for n in [".env", ".notes.txt", "a.md", ".x.png"]:
    try:
        if n.endswith(".png"):
            p = import_image(d, n, b"x"); 
        else:
            p, k = import_attachment(d, n, b"data")
        print(n, "->", p, end=" ")
        try: attachment_path(d, p); print("served")
        except Exception as e: print("NOT SERVED", type(e).__name__)
    except Exception as e:
        print(n, "EXC", e)
print([a["path"] for a in list_attachments(d)])
