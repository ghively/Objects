from h import *
root = copy("space-sample")
sp = Space(root)
print("after Space()", (root/".object").exists())
c = TestClient(create_app(sp, None, watch=False))
for u in ["/api/space","/api/objects"]:
    c.get(u); print(u, (root/".object").exists())
