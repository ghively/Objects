from h import *
from objectapp.spaces import create_space
loc = T/"loc"; loc.mkdir()
for n in ["..", ".", "a/b", "../escape", "...", " .. ", "x."]:
    try: print(repr(n), create_space(n, loc))
    except Exception as e: print(repr(n), type(e).__name__, e)
