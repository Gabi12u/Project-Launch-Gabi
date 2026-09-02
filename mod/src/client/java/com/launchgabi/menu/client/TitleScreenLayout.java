package com.launchgabi.menu.client;

import java.util.ArrayList;
import java.util.List;
import java.util.WeakHashMap;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;

/**
 * Reflows the title screen's centered button column so an extra button
 * (added by another mod through the same {@link Screens#getButtons} list)
 * gets its own evenly spaced row instead of overlapping the row below it,
 * and computes the backing panel {@link TitleScreenMixin} draws behind the
 * whole cluster.
 *
 * This only recognizes the common convention of a mod centering its button
 * the same way vanilla centers Singleplayer/Multiplayer/Realms. A mod that
 * places its own button elsewhere, or that runs its {@code AFTER_INIT}
 * callback after this one and only then adds a button, is outside what any
 * fixed convention can catch; that limit was disclosed up front and is not
 * something a heuristic here can close.
 */
public final class TitleScreenLayout {
	private static final int ROW_SPACING = 24;
	private static final int MIN_COLUMN_WIDTH = 150;
	private static final int SPLIT_ROW_MIN_WIDTH = 90;
	private static final int SPLIT_ROW_MAX_WIDTH = 110;
	private static final int SPLIT_ROW_MAX_OFFSET = 110;
	private static final int ICON_SIZE = 20;
	private static final int PANEL_MARGIN = 14;
	private static final int CENTER_TOLERANCE = 2;

	private static final WeakHashMap<Screen, int[]> PANEL_BOUNDS = new WeakHashMap<>();

	private TitleScreenLayout() {
	}

	public static void onAfterInit(Minecraft client, Screen screen, int scaledWidth, int scaledHeight) {
		if (!(screen instanceof TitleScreen)) {
			return;
		}

		List<AbstractWidget> buttons = Screens.getButtons(screen);
		int centerX = scaledWidth / 2;

		List<AbstractWidget> column = new ArrayList<>();
		List<AbstractWidget> splitRow = new ArrayList<>();
		List<AbstractWidget> icons = new ArrayList<>();

		for (AbstractWidget widget : buttons) {
			int width = widget.getWidth();
			int height = widget.getHeight();
			int center = widget.getX() + width / 2;
			int offsetFromCenter = Math.abs(center - centerX);

			if (width == ICON_SIZE && height == ICON_SIZE) {
				icons.add(widget);
			} else if (width >= MIN_COLUMN_WIDTH && offsetFromCenter <= CENTER_TOLERANCE) {
				column.add(widget);
			} else if (width >= SPLIT_ROW_MIN_WIDTH && width <= SPLIT_ROW_MAX_WIDTH && offsetFromCenter <= SPLIT_ROW_MAX_OFFSET) {
				splitRow.add(widget);
			}
		}

		if (column.isEmpty()) {
			PANEL_BOUNDS.remove(screen);
			return;
		}

		column.sort((a, b) -> Integer.compare(a.getY(), b.getY()));

		int anchorY = column.get(0).getY();
		int extraRows = Math.max(0, column.size() - 3);

		for (int i = 0; i < column.size(); i++) {
			column.get(i).setY(anchorY + i * ROW_SPACING);
		}

		if (extraRows > 0) {
			int shift = extraRows * ROW_SPACING;
			for (AbstractWidget widget : splitRow) {
				widget.setY(widget.getY() + shift);
			}
			for (AbstractWidget widget : icons) {
				widget.setY(widget.getY() + shift);
			}
		}

		int left = Integer.MAX_VALUE;
		int top = Integer.MAX_VALUE;
		int right = Integer.MIN_VALUE;
		int bottom = Integer.MIN_VALUE;

		for (List<AbstractWidget> group : List.of(column, splitRow, icons)) {
			for (AbstractWidget widget : group) {
				left = Math.min(left, widget.getX());
				top = Math.min(top, widget.getY());
				right = Math.max(right, widget.getRight());
				bottom = Math.max(bottom, widget.getBottom());
			}
		}

		left = Math.max(0, left - PANEL_MARGIN);
		top = Math.max(0, top - PANEL_MARGIN);
		right = Math.min(scaledWidth, right + PANEL_MARGIN);
		bottom = Math.min(scaledHeight, bottom + PANEL_MARGIN);

		PANEL_BOUNDS.put(screen, new int[] {left, top, right, bottom});
	}

	/** The panel rectangle to draw behind {@code screen}'s buttons, or null if none was computed. */
	public static int[] panelBounds(Screen screen) {
		return PANEL_BOUNDS.get(screen);
	}
}
