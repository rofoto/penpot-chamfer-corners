There are two realistic ways to implement chamfered (beveled) corners in Penpot: add a native corner type to Penpot itself, or build a plugin that converts selected shapes into chamfered vector paths. The plugin is much easier to implement; the native feature is the better long-term solution if you want editable corners that behave like Penpot's existing corner-radius controls.
Penpot already has a plugin API for reading and modifying design objects, and its shape model supports corner-radius properties. The missing piece is a first-class chamfer operation, rather than the ability to draw the resulting geometry. 

Penpot plugins API
+2



Option 1: Build a plugin
Best starting point
A plugin could add a panel with controls such as:
Chamfer Corners
Example of a possible plugin interface

Corner style
Chamfer / straight cut
Cut distance
12 px

per corner




Apply to selected shapes
Example UI


What the plugin needs to do
1. Read the selection. Identify selected rectangles and other supported shapes through the Penpot Plugin API.
2. Calculate the chamfer geometry. For each corner, replace the corner point with two points offset along the adjacent edges.
3. Create or update the geometry. Write the resulting vector path back to the document, preserving the original fill, stroke, opacity, and transforms where possible.
4. Expose controls. Provide a numeric cut distance, independent corner toggles, and options for applying the effect to multiple shapes.
5. Handle resizing and repeat edits. Either regenerate the path from stored parameters or keep a reference to the original shape so repeated applications don't progressively damage the geometry.
Penpot's plugin system uses JavaScript or TypeScript, a manifest file, and the Plugin API. The official documentation provides starter templates and examples. 

Penpot Help Center
+1



The main technical limitation
The current public Plugin API exposes borderRadius and four individual corner-radius properties, but these describe radii, not a choice between rounded and chamfered geometry. 

Penpot plugins API



So the practical plugin implementation is to replace the original rectangle with a path. The plugin can save its own parameters on the shape using setPluginData(), which helps support later edits. However, the result won't automatically behave like a native rectangle with live corner controls.
A simple chamfer calculation works like this:
For a rectangle with width \(W\), height \(H\), and cut distance \(d\), the top-left corner becomes two points:
\[
P_1=(x+d,y),\qquad P_2=(x,y+d)
\]

Repeat around the rectangle to create an eight-point closed polygon. For a standard 45-degree chamfer, both offsets are equal. Clamp the cut distance so opposing cuts don't overlap.
For arbitrary paths, curves, and irregular polygons, the geometry algorithm becomes more involved.
Option 2: Implement chamfer corners natively
This means contributing code to the Penpot application itself, rather than building an external plugin.

1. Add a corner-type control
Extend the Design sidebar with a corner style selector: Sharp, Rounded, and Chamfered. Support independent corner styles and a shared cut-distance field.




2. Extend the shape data model
Store the corner type and chamfer distance as persistent shape properties, including per-corner overrides. Ensure the properties survive save, reload, copy/paste, and import/export.




3. Implement the geometry engine
Generate the appropriate straight segments or curves for each corner. Recalculate them when dimensions, corner settings, or transforms change, and handle small shapes without self-intersections.




4. Update rendering and exports
Ensure the canvas, SVG export, thumbnails, and other render paths all display the same geometry. Preserve stroke alignment, clipping, shadows, and boolean operations.




5. Add tests and documentation
Cover geometry calculations, resizing, mixed corner styles, persistence, export, and compatibility with existing documents. Update the user guide and plugin/API types if appropriate.



Penpot's developer documentation describes shapes as structured objects rendered into SVG nodes, so the feature needs to be implemented consistently across the model and rendering pipeline, not just added as a UI control. 

Penpot Help Center
+1



Which approach makes sense?
Requirement	Plugin	Native implementation
Chamfer rectangles quickly	Excellent	Excellent
Works on existing selections	Yes	Yes
Live editing of cut distance	Limited; requires regeneration	Native
Automatically adapts on resize	Only if explicitly implemented	Yes, if designed that way
Works on arbitrary vector paths	Possible, with limitations	Possible, with deeper geometry work
Appears in the normal Design sidebar	No, typically a separate plugin UI	Yes
Development effort	Low to moderate	Moderate to high
Requires a Penpot source-code fork	No	Usually, unless contributed upstream
My recommendation
Start with a TypeScript plugin that chamfers rectangles and rounded rectangles, with controls for cut distance, individual corners, and whether to replace or duplicate the original. That establishes the desired behaviour and geometry before investing in a native feature.
If you want the chamfer controls to work exactly like Penpot's existing radius controls—including automatic resizing and native editing—the next step is a native implementation and an upstream contribution.
Useful starting points:
- Official plugin development guide
- Plugin API: ShapeBase properties and methods
- Penpot source code on GitHub
- Related issue: corner radius for paths and the Pen tool
One important design decision before implementation: do you want chamfered corners only on rectangles and rounded rectangles, or do you want a corner-style system that also works on arbitrary Pen-tool paths? The latter is substantially more complex, but it would make a more general-purpose feature.
