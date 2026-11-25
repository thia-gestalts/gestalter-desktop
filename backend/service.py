import json
import sys
import hashlib

from replica import AccountStore
from inbox import read_folder
from platform_paths import data_directory
from store import READS, WRITES, Store


def main():
    store = Store(data_directory())
    account_store = None
    active_scope = None

    def account(scope, method, args):
        nonlocal account_store, active_scope
        if scope != active_scope:
            directory = data_directory() / "accounts" / hashlib.sha256(scope.encode()).hexdigest()
            replacement = AccountStore(directory)
            if account_store:
                account_store.close()
            account_store, active_scope = replacement, scope
        return account_store.call(method, args)

    methods = {method: getattr(store, name) for method, name in {**READS, **WRITES}.items()}
    methods.update(account=account, readInboxFolder=read_folder)
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
        if account_store:
            account_store.close()


if __name__ == "__main__":
    main()
