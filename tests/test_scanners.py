import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from gamehub import scanners
from gamehub.store import Store


class VdfTests(unittest.TestCase):
    def test_parses_nested_keyvalues(self):
        text = '''
        "libraryfolders"
        {
            "0" { "path" "/home/me/.local/share/Steam" "apps" { "570" "123" } }
            "1" { "path" "/mnt/games/SteamLibrary" }
        }'''
        data = scanners.parse_vdf(text)
        self.assertEqual(data["libraryfolders"]["1"]["path"], "/mnt/games/SteamLibrary")
        self.assertEqual(data["libraryfolders"]["0"]["apps"]["570"], "123")


class SteamScanTests(unittest.TestCase):
    def test_finds_games_and_skips_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Steam"
            apps = root / "steamapps"
            apps.mkdir(parents=True)
            (apps / "appmanifest_620.acf").write_text('"AppState" { "appid" "620" "name" "Portal 2" "SizeOnDisk" "100" }')
            (apps / "appmanifest_1493710.acf").write_text('"AppState" { "appid" "1493710" "name" "Proton Experimental" }')
            (apps / "appmanifest_228980.acf").write_text('"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" }')
            with mock.patch.object(scanners, "STEAM_ROOTS", [root]):
                games = scanners.scan_steam()
        self.assertEqual([g["title"] for g in games], ["Portal 2"])
        self.assertEqual(games[0]["launch"]["uri"], "steam://rungameid/620")
        self.assertEqual(games[0]["size"], 100)


class DesktopScanTests(unittest.TestCase):
    def test_only_games_category(self):
        with tempfile.TemporaryDirectory() as tmp:
            apps = Path(tmp) / "applications"
            apps.mkdir()
            (apps / "supertux.desktop").write_text("[Desktop Entry]\nType=Application\nName=SuperTux\nExec=supertux2 %U\nCategories=Game;ArcadeGame;\n")
            (apps / "editor.desktop").write_text("[Desktop Entry]\nType=Application\nName=Editor\nExec=editor\nCategories=Utility;\n")
            (apps / "steam-game.desktop").write_text("[Desktop Entry]\nType=Application\nName=Via Steam\nExec=steam steam://rungameid/1\nCategories=Game;\n")
            with mock.patch.object(scanners, "_xdg_app_dirs", lambda: [apps]):
                games = scanners.scan_desktop()
        self.assertEqual([g["title"] for g in games], ["SuperTux"])
        self.assertEqual(games[0]["launch"]["argv"], ["supertux2"])


class StoreTests(unittest.TestCase):
    def test_settings_merge_and_custom_games(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Path(tmp) / "state.json")
            store.update_settings({"accent": "#ff0000", "sources": {"steam": False}, "bogus": 1})
            settings = Store(Path(tmp) / "state.json").settings()
            self.assertEqual(settings["accent"], "#ff0000")
            self.assertFalse(settings["sources"]["steam"])
            self.assertTrue(settings["sources"]["lutris"])
            self.assertNotIn("bogus", json.loads((Path(tmp) / "state.json").read_text())["settings"])

            entry = store.add_custom({"title": "Doom", "command": "gzdoom"})
            store.add_playtime(entry["id"], 90)
            self.assertEqual(store.meta(entry["id"])["playtime"], 90)
            self.assertTrue(store.remove_custom(entry["id"]))
            self.assertEqual(store.custom_games(), [])


class LauncherAndEpicTests(unittest.TestCase):
    def _write(self, apps, name, body):
        (apps / name).write_text("[Desktop Entry]\nType=Application\n" + body)

    def test_launchers_go_to_games_not_apps(self):
        with tempfile.TemporaryDirectory() as tmp:
            apps = Path(tmp) / "applications"
            apps.mkdir()
            self._write(apps, "steam.desktop", "Name=Steam\nExec=steam %U\nCategories=Network;FileTransfer;Game;\n")
            self._write(apps, "org.prismlauncher.PrismLauncher.desktop", "Name=Prism Launcher\nExec=prismlauncher\nCategories=Game;\n")
            self._write(apps, "firefox.desktop", "Name=Firefox\nExec=firefox %u\nCategories=Network;WebBrowser;\n")
            self._write(apps, "glitch.desktop", "Name=Switcheroo\nExec=switcheroo\nCategories=Utility;\n")
            with mock.patch.object(scanners, "_xdg_app_dirs", lambda: [apps]):
                launchers = sorted(g["title"] for g in scanners.scan_launchers())
                app_titles = sorted(a["title"] for a in scanners.scan_apps())
                games = scanners.scan_desktop()
        self.assertEqual(launchers, ["Prism Launcher", "Steam"])
        self.assertEqual(app_titles, ["Firefox", "Switcheroo"])
        self.assertEqual(games, [])

    def test_epic_games_in_wine_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / ".wine"
            manifests = prefix / scanners.EPIC_MANIFESTS
            manifests.mkdir(parents=True)
            (manifests / "a.item").write_text(json.dumps({
                "AppName": "Fortnite", "DisplayName": "Fortnite",
                "InstallLocation": "C:\\Program Files\\Epic Games\\Fortnite", "LaunchExecutable": "Fortnite.exe",
            }))
            with mock.patch.object(scanners, "HOME", Path(tmp)), \
                 mock.patch.object(scanners, "LEGENDARY_ROOTS", []):
                games = scanners.scan_epic()
        self.assertEqual([g["title"] for g in games], ["Fortnite"])
        argv = games[0]["launch"]["argv"]
        self.assertIn(f"WINEPREFIX={prefix}", argv)
        self.assertTrue(argv[-1].endswith("drive_c/Program Files/Epic Games/Fortnite/Fortnite.exe"))

    def test_prism_instances(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "PrismLauncher"
            inst = root / "instances" / "fabric-1.21"
            inst.mkdir(parents=True)
            (inst / "instance.cfg").write_text("[General]\nname=Fabric 1.21 Modpack\niconKey=default\n")
            with mock.patch.object(scanners, "MOD_LAUNCHERS", [(root, "prismlauncher", None)]):
                games = scanners.scan_modlaunchers()
        self.assertEqual(games[0]["title"], "Fabric 1.21 Modpack")
        self.assertEqual(games[0]["launch"]["argv"], ["prismlauncher", "--launch", "fabric-1.21"])


class CustomAndDemoTests(unittest.TestCase):
    def test_custom_game_conversion(self):
        game = scanners.custom_to_game({"id": "custom:1", "title": "Doom", "command": "gzdoom", "cover": "https://x/c.jpg", "hero": ""})
        self.assertEqual(game["launch"], {"type": "cmd", "command": "gzdoom"})
        self.assertEqual(game["art"]["hero"], ["https://x/c.jpg"])

    def test_demo_library(self):
        self.assertTrue(all(g["launch"]["type"] == "demo" for g in scanners.demo_games()))


class LibraryTests(unittest.TestCase):
    def test_library_with_custom_game_in_both_modes(self):
        from gamehub.server import Library
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Path(tmp) / "state.json")
            store.update_settings({"sources": {k: False for k in ("steam", "heroic", "epic", "lutris", "mods", "launchers", "desktop", "apps")}})
            store.add_custom({"title": "Doom", "command": "gzdoom"})
            for demo in (False, True):
                titles = [g["title"] for g in Library(store, demo=demo).public_list()]
                self.assertIn("Doom", titles)


if __name__ == "__main__":
    unittest.main()
