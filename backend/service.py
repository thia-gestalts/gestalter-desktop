import json
import sys

from platform_paths import data_directory
from store import Store


def main():
    store = Store(data_directory())
    methods = {
        "listNotes": store.list_notes,
        "getNote": store.note,
        "saveNote": store.edit_note,
        "deleteNote": store.delete_note,
        "link": store.link,
        "attachImage": store.attach_image,
        "detachImage": store.detach_image,
        "getImage": store.image,
        "importPractice": store.import_practice,
        "recentPractice": store.recent_practice,
    }
    try:
        print(json.dumps({"ready": True}), flush=True)
        for line in sys.stdin:
            request = json.loads(line)
            try:
                result = methods[request["method"]](*request["args"])
                response = {"result": result}
            except ValueError as error:
                response = {"error": str(error)}
            except Exception:
                print("Gestalter could not complete a storage request.", file=sys.stderr)
                response = {"error": "Could not complete the storage request."}
            print(json.dumps({"id": request["id"], **response}), flush=True)
    finally:
        store.close()


if __name__ == "__main__":
    main()
