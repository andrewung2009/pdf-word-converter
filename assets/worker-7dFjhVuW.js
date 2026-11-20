var e=class{constructor(e){this.assetPath=e}async convert(e,t){let n=await this.load(),{FS:r}=n,i=await e.arrayBuffer();r.writeFile(`/input.pdf`,new Uint8Array(i)),n.globals.get(`convert`)(t);let a=r.readFile(`/output.docx`);return new Blob([a],{type:`application/vnd.openxmlformats-officedocument.wordprocessingml.document`})}async load(){return this.pyodidePromise?this.pyodidePromise:this.pyodidePromise=Promise.resolve().then(async()=>{let{loadPyodide:e}=await import(this.getAssetPath(`pyodide.js`)),t=await e();return await Promise.all([`pymupdf-1.26.1-cp313-none-pyodide_2025_0_wasm32.whl`,`python_docx-1.2.0-py3-none-any.whl`,`pdf2docx-0.5.8-py3-none-any.whl`,`lxml-5.4.0-cp313-cp313-pyodide_2025_0_wasm32.whl`,`typing_extensions-4.12.2-py3-none-any.whl`,`numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl`,`opencv_python-4.11.0.86-cp313-cp313-pyodide_2025_0_wasm32.whl`,`fonttools-4.56.0-py3-none-any.whl`].map(e=>t.loadPackage(this.getAssetPath(e)))),t.runPython(`
      from pdf2docx import Converter

      def convert(pages):
          cv = Converter("/input.pdf")
          cv.convert("/output.docx", pages=pages)
          cv.close()
      `),t})}getAssetPath(e){return(this.assetPath||`./`)+e}};const t=self;let n=null,r=!1;const i=`
from pdf2docx.image.ImagesExtractor import ImagesExtractor
from pdf2docx.common.share import BlockType
import base64
import pymupdf as fitz

_white_png = base64.b64decode(${JSON.stringify(`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC`)})

def _normalize_pixmap(image):
    if image is None:
        return None
    try:
        base = fitz.Pixmap(image, 0) if getattr(image, 'alpha', False) else image
        return fitz.Pixmap(fitz.csRGB, base)
    except Exception:
        try:
            return fitz.Pixmap(fitz.csRGB, image)
        except Exception:
            return None

def _fallback_image_dict(image, bbox):
    return {
        'type': BlockType.IMAGE.value,
        'bbox': tuple(bbox),
        'width': getattr(image, 'width', 1),
        'height': getattr(image, 'height', 1),
        'image': _white_png,
    }

_original_to_raw_dict = ImagesExtractor._to_raw_dict

def _safe_to_raw_dict(image, bbox):
    try:
        return _original_to_raw_dict(image, bbox)
    except Exception:
        converted = _normalize_pixmap(image)
        if converted is not None:
            try:
                return _original_to_raw_dict(converted, bbox)
            except Exception:
                pass
        return _fallback_image_dict(image, bbox)

ImagesExtractor._to_raw_dict = staticmethod(_safe_to_raw_dict)

_original_rotate_image = ImagesExtractor._rotate_image

def _safe_rotate_image(pixmap, rotation):
    try:
        return _original_rotate_image(pixmap, rotation)
    except Exception:
        converted = _normalize_pixmap(pixmap)
        if converted is not None:
            try:
                return _original_rotate_image(converted, rotation)
            except Exception:
                pass
        raise

ImagesExtractor._rotate_image = staticmethod(_safe_rotate_image)

_original_pixmap_to_cv = ImagesExtractor._pixmap_to_cv_image

def _safe_pixmap_to_cv(pixmap):
    try:
        return _original_pixmap_to_cv(pixmap)
    except Exception:
        converted = _normalize_pixmap(pixmap)
        if converted is not None:
            return _original_pixmap_to_cv(converted)
        raise

ImagesExtractor._pixmap_to_cv_image = staticmethod(_safe_pixmap_to_cv)
`;function a(e,n=[]){t.postMessage(e,n)}function o(e){let t=e instanceof Error?e.message:typeof e==`string`?e:``;return/memory|out of memory|MemoryError/i.test(t)?`The PDF is too large for the high-fidelity engine. Use fast mode or exact layout instead.`:`The high-fidelity engine could not process this PDF. Use fast mode or exact layout instead.`}t.onmessage=t=>{let s=t.data;if(s?.type!==`convert`)return;let{id:c,pdf:l,assetBase:u}=s;(async()=>{try{let t=n===null;n||=new e(u),a({type:`status`,id:c,stage:t?`loading`:`converting`}),r||=((await n.load()).runPython(i),!0);let o=new Blob([l],{type:`application/pdf`}),d=await n.convert(o,s.pageIndexes);a({type:`status`,id:c,stage:`packaging`});let f=await d.arrayBuffer();a({type:`result`,id:c,docx:f},[f])}catch(e){console.error(e),a({type:`error`,id:c,message:o(e)})}})()};