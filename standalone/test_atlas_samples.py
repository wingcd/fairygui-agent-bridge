"""Check atlas pixel round-trips for every image in a sample project."""
import sys
from PIL import Image, ImageChops
from atlas import pack, render
from fgui import project_root, packages, resource_path


def run(project):
    count = 0
    for folder, tree in packages(project_root(project)):
        sources = {}
        try:
            for item in tree.findall('./resources/image'):
                with Image.open(resource_path(folder, item)) as image:
                    sources[item.attrib['id']] = image.convert('RGBA')
            layout = pack([{'id': key, 'width': image.width, 'height': image.height} for key, image in sources.items()])
            canvases = render(layout, sources)
            for page, canvas in zip(layout, canvases):
                for item in page['items']:
                    x, y, w, h = (item[k] for k in ('x', 'y', 'width', 'height'))
                    actual = canvas.crop((x, y, x+w, y+h))
                    if ImageChops.difference(actual, sources[item['id']]).getbbox(alpha_only=False):
                        raise ValueError(f"pixel mismatch: {folder.name}/{item['id']}")
                    count += 1
            for canvas in canvases:
                canvas.close()
        finally:
            for image in sources.values():
                image.close()
    return count


if __name__ == '__main__':
    print(f'{run(sys.argv[1])} images verified')
