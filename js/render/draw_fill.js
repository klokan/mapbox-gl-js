'use strict';

var pixelsToTileUnits = require('../source/pixels_to_tile_units');

module.exports = draw;

function draw(painter, source, layer, coords) {
    var gl = painter.gl;
    gl.enable(gl.STENCIL_TEST);

    var color = layer.paint['fill-color'];
    var image = layer.paint['fill-pattern'];
    var strokeColor = layer.paint['fill-outline-color'];
    var opacity = layer.paint['fill-opacity'];

    // Draw fill
    if (image ? !painter.isOpaquePass : painter.isOpaquePass === (color[3] === 1 && opacity === 1)) {
        // Once we switch to earcut drawing we can pull most of the WebGL setup
        // outside of this coords loop.
        painter.setDepthSublayer(1);
        for (var i = 0; i < coords.length; i++) {
            drawFill(painter, source, layer, coords[i]);
        }
    }

    // Draw stroke
    if (!painter.isOpaquePass && layer.paint['fill-antialias']) {
        if (strokeColor || !layer.paint['fill-pattern']) {
            var outlineProgram = painter.useProgram('outline');
            painter.lineWidth(2);
            painter.depthMask(false);

            if (strokeColor) {
                // If we defined a different color for the fill outline, we are
                // going to ignore the bits in 0x07 and just care about the global
                // clipping mask.
                painter.setDepthSublayer(2);
            } else {
                // Otherwise, we only want to drawFill the antialiased parts that are
                // *outside* the current shape. This is important in case the fill
                // or stroke color is translucent. If we wouldn't clip to outside
                // the current shape, some pixels from the outline stroke overlapped
                // the (non-antialiased) fill.
                painter.setDepthSublayer(0);
            }
            gl.uniform2f(outlineProgram.u_world, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.uniform4fv(outlineProgram.u_color, strokeColor ? strokeColor : color);
            gl.uniform1f(outlineProgram.u_opacity, opacity);

            for (var j = 0; j < coords.length; j++) {
                drawStroke(painter, source, layer, coords[j]);
            }
        } else {
            var outlinePatternProgram = painter.useProgram('outlinepattern');
            painter.lineWidth(2);
            painter.depthMask(false);
            // Otherwise, we only want to drawFill the antialiased parts that are
            // *outside* the current shape. This is important in case the fill
            // or stroke color is translucent. If we wouldn't clip to outside
            // the current shape, some pixels from the outline stroke overlapped
            // the (non-antialiased) fill.
            painter.setDepthSublayer(0);
            gl.uniform2f(outlinePatternProgram.u_world, gl.drawingBufferWidth, gl.drawingBufferHeight);

            for (var k = 0; k < coords.length; k++) {
                drawStroke(painter, source, layer, coords[k]);
            }
        }

    }
}

function drawFill(painter, source, layer, coord) {
    var tile = source.getTile(coord);
    var bucket = tile.getBucket(layer);
    if (!bucket) return;
    var bufferGroups = bucket.bufferGroups.fill;
    if (!bufferGroups) return;

    var gl = painter.gl;

    var color = layer.paint['fill-color'];
    var image = layer.paint['fill-pattern'];
    var opacity = layer.paint['fill-opacity'];
    var program;

    if (image) {
        // Draw texture fill
        program = painter.useProgram('pattern');
        setPattern(image, opacity, tile, coord, painter, program);

        gl.activeTexture(gl.TEXTURE0);
        painter.spriteAtlas.bind(gl, true);

    } else {
        program = painter.useProgram('fill');
        gl.uniform4fv(program.u_color, color);
        gl.uniform1f(program.u_opacity, opacity);
    }

    gl.uniformMatrix4fv(program.u_matrix, false, painter.translatePosMatrix(
        coord.posMatrix,
        tile,
        layer.paint['fill-translate'],
        layer.paint['fill-translate-anchor']
    ));

    painter.enableTileClippingMask(coord);

    for (var i = 0; i < bufferGroups.length; i++) {
        var group = bufferGroups[i];
        group.vaos[layer.id].bind(gl, program, group.layout.vertex, group.layout.element);
        gl.drawElements(gl.TRIANGLES, group.layout.element.length, gl.UNSIGNED_SHORT, 0);
    }
}

function drawStroke(painter, source, layer, coord) {
    var tile = source.getTile(coord);
    var bucket = tile.getBucket(layer);
    if (!bucket) return;

    var gl = painter.gl;
    var bufferGroups = bucket.bufferGroups.fill;

    var image = layer.paint['fill-pattern'];
    var opacity = layer.paint['fill-opacity'];
    var program = image ? painter.useProgram('outlinepattern') : painter.useProgram('outline');

    gl.uniformMatrix4fv(program.u_matrix, false, painter.translatePosMatrix(
        coord.posMatrix,
        tile,
        layer.paint['fill-translate'],
        layer.paint['fill-translate-anchor']
    ));

    if (image) { setPattern(image, opacity, tile, coord, painter, program); }

    painter.enableTileClippingMask(coord);

    for (var k = 0; k < bufferGroups.length; k++) {
        var group = bufferGroups[k];
        group.secondVaos[layer.id].bind(gl, program, group.layout.vertex, group.layout.element2);
        gl.drawElements(gl.LINES, group.layout.element2.length * 2, gl.UNSIGNED_SHORT, 0);
    }
}


function setPattern(image, opacity, tile, coord, painter, program) {
    var gl = painter.gl;

    var imagePosA = painter.spriteAtlas.getPosition(image.from, true);
    var imagePosB = painter.spriteAtlas.getPosition(image.to, true);
    if (!imagePosA || !imagePosB) return;

    gl.uniform1i(program.u_image, 0);
    gl.uniform2fv(program.u_pattern_tl_a, imagePosA.tl);
    gl.uniform2fv(program.u_pattern_br_a, imagePosA.br);
    gl.uniform2fv(program.u_pattern_tl_b, imagePosB.tl);
    gl.uniform2fv(program.u_pattern_br_b, imagePosB.br);
    gl.uniform1f(program.u_opacity, opacity);
    gl.uniform1f(program.u_mix, image.t);

    gl.uniform1f(program.u_tile_units_to_pixels, 1 / pixelsToTileUnits(tile, 1, painter.transform.tileZoom));
    gl.uniform2fv(program.u_pattern_size_a, imagePosA.size);
    gl.uniform2fv(program.u_pattern_size_b, imagePosB.size);
    gl.uniform1f(program.u_scale_a, image.fromScale);
    gl.uniform1f(program.u_scale_b, image.toScale);

    var tileSizeAtNearestZoom = tile.tileSize * Math.pow(2, painter.transform.tileZoom - tile.coord.z);

    var pixelX = tileSizeAtNearestZoom * (tile.coord.x + coord.w * Math.pow(2, tile.coord.z));
    var pixelY = tileSizeAtNearestZoom * tile.coord.y;
    // split the pixel coord into two pairs of 16 bit numbers. The glsl spec only guarantees 16 bits of precision.
    gl.uniform2f(program.u_pixel_coord_upper, pixelX >> 16, pixelY >> 16);
    gl.uniform2f(program.u_pixel_coord_lower, pixelX & 0xFFFF, pixelY & 0xFFFF);

    gl.activeTexture(gl.TEXTURE0);
    painter.spriteAtlas.bind(gl, true);
}
