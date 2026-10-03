"""Local imports never need Drive, and merged EPUBs use their outer cover."""
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("covers", Path(__file__).parents[1] / "ops/pi/tools/rr-cover-extract.py")
covers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(covers)

def epub(version=3):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
        declared = 'properties="cover-image"' if version == 3 else ''
        archive.writestr("OEBPS/content.opf", f'<package><metadata><meta name="cover" content="outer"/></metadata><manifest><item id="outer" href="outer.jpg" {declared}/></manifest></package>')
        archive.writestr("OEBPS/outer.jpg", b"outer" * 300)
        archive.writestr("OEBPS/book0/cover.jpg", b"constituent" * 3000)
    return data.getvalue()

class Extraction(unittest.TestCase):
    def test_declared_cover_beats_larger_constituent(self):
        for version in (2, 3):
            self.assertEqual(covers.zip_cover_local(epub(version), False), b"outer" * 300)

    def test_local_import_retries_old_drive_failure_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "collection.epub"
            source.write_bytes(epub())
            with patch.object(covers, "OUT_DIR", directory), patch.object(covers, "local_files", {"Ltest": str(source)}), \
                 patch.object(covers, "state", {"Ltest": "fail"}), patch.object(covers, "save") as save, \
                 patch.object(covers, "fetch_whole", side_effect=AssertionError("Drive must not be used")):
                covers.handle({"id": "Ltest", "format": "EPUB"})
                save.assert_called_once_with("Ltest", b"outer" * 300)
                self.assertNotIn("Ltest", covers.state)

    def test_missing_local_mapping_is_deferred_not_sent_to_drive(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(covers, "OUT_DIR", directory), \
             patch.object(covers, "local_files", {}), patch.object(covers, "state", {}), \
             patch.object(covers, "save") as save, patch.object(covers, "fetch_whole", side_effect=AssertionError("Drive must not be used")):
            covers.handle({"id": "Lunknown", "format": "EPUB"})
            save.assert_not_called()
            self.assertNotIn("Lunknown", covers.state)

if __name__ == "__main__":
    unittest.main()
