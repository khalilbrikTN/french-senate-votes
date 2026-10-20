"""Command line entry point:
python -m importers {senators|display-settings|votes|individual-votes|all} [--commit]

Dry run is the default: the import runs in a transaction that is rolled back.
`all` runs senators -> display-settings -> votes -> individual-votes. With
--commit each step is committed on its own and the run stops at the first
failure; in a dry run the steps share one transaction so later steps see the
earlier changes. display-settings loads the group colours of
importers/group_colors.json.
"""

import argparse
import sys
import time

from . import display_settings, individual_votes, senators, votes
from .common import CACHE_DIR, DOSLEG_URL, connect, download, fail_run, file_info, finish_run, start_run

STEPS = {
    "senators": (senators, "senat"),
    "display-settings": (display_settings, "config"),
    "votes": (votes, "dosleg"),
    "individual-votes": (individual_votes, "dosleg"),
}


def parse_args(argv):
    parser = argparse.ArgumentParser(
        prog="python -m importers", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", choices=[*STEPS, "all"], help="what to import")
    parser.add_argument("--commit", action="store_true",
                        help="write the changes to the database (default: dry run, rolled back)")
    parser.add_argument("--dosleg-zip", metavar="PATH",
                        help="use this local dosleg.zip instead of downloading it")
    parser.add_argument("--senat-dir", metavar="PATH",
                        help="folder with ODSEN_GENERAL.json, ODSEN_ELUSEN.json, ODSEN_HISTOGROUPES.json "
                             "and api_senateurs.json, instead of downloading them")
    return parser.parse_args(argv)


def get_sources(kinds, args):
    sources = {}
    if "senat" in kinds:
        sources["senat"] = senators.get_sources(args.senat_dir)
    if "config" in kinds:
        sources["config"] = display_settings.get_sources()
    if "dosleg" in kinds:
        if args.dosleg_zip:
            sources["dosleg"] = file_info(args.dosleg_zip, DOSLEG_URL)
        else:
            print("Downloading the Dosleg dump...")
            sources["dosleg"] = download(DOSLEG_URL, CACHE_DIR / "dosleg.zip")
        if not sources["dosleg"]["last_modified"]:
            print("  warning: the publication date (HTTP Last-Modified) of this local file is unknown; "
                  "source_last_modified will be stored as null")
    return sources


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args(argv)
    names = list(STEPS) if args.target == "all" else [args.target]
    mode = "COMMIT" if args.commit else "DRY RUN (nothing is written; use --commit to write)"
    print(f"Mode: {mode}")
    try:
        sources = get_sources({STEPS[n][1] for n in names}, args)
    except Exception as exc:
        print(f"\nFAILED: could not get the source files: {exc}\nNothing was written.")
        return 1

    conn = connect()
    try:
        for name in names:
            module, kind = STEPS[name]
            print(f"\n== {name} ==")
            started = time.time()
            run_id = start_run(conn) if args.commit else None
            try:
                counts = module.run(conn, sources[kind])
                if args.commit:
                    finish_run(conn, run_id, **counts)
                    conn.commit()
                    print(f"COMMITTED {name} (import run {run_id}) in {time.time() - started:.0f}s")
                else:
                    print(f"{name} OK in {time.time() - started:.0f}s")
            except Exception as exc:
                conn.rollback()
                if run_id is not None:
                    fail_run(conn, run_id, exc)
                print(f"\nFAILED: {name}: {exc}")
                if args.commit:
                    print("Nothing from this step was written; earlier steps stay committed.")
                else:
                    print("Dry run rolled back.")
                return 1
        if not args.commit:
            conn.rollback()
            print("\nDRY RUN finished: all changes rolled back. Run again with --commit to write them.")
        return 0
    finally:
        conn.close()  # closing without commit discards any open transaction


if __name__ == "__main__":
    sys.exit(main())
