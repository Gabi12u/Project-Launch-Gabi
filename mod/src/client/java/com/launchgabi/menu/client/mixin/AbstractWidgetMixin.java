package com.launchgabi.menu.client.mixin;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.util.ARGB;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Adds a smooth hover glow and a short click flash on top of every
 * {@link AbstractWidget}, vanilla or mod-added, instead of vanilla's instant
 * three-sprite swap. Mixed into the base class rather than {@code Button} so
 * it also reaches sliders, icon buttons and anything else built on top of
 * this same widget, which is what "any mod button automatically gets the
 * same animation" actually requires: the animation only needs the shape and
 * hover/click state every widget already has, not the vanilla button sprite
 * a mod might not even be using.
 */
@Mixin(AbstractWidget.class)
public abstract class AbstractWidgetMixin {
	@Shadow
	public boolean visible;

	@Shadow
	public abstract boolean isHoveredOrFocused();

	@Shadow
	public abstract boolean isActive();

	@Shadow
	public abstract int getX();

	@Shadow
	public abstract int getY();

	@Shadow
	public abstract int getRight();

	@Shadow
	public abstract int getBottom();

	@Unique
	private long launchGabiMenu$lastNanoTime;

	@Unique
	private float launchGabiMenu$hoverProgress;

	@Unique
	private long launchGabiMenu$pressStartNanos = -1L;

	@Inject(method = "render", at = @At("TAIL"))
	private void launchGabiMenu$onRenderTail(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick, CallbackInfo info) {
		if (!this.visible) {
			return;
		}

		long now = System.nanoTime();
		if (this.launchGabiMenu$lastNanoTime == 0L) {
			this.launchGabiMenu$lastNanoTime = now;
		}
		// Clamped so a lag spike or the frame a screen first opens cannot be
		// read as "half a second passed", which would otherwise snap the glow
		// straight to its target instead of easing into it.
		float deltaSeconds = Math.min((float) ((now - this.launchGabiMenu$lastNanoTime) / 1_000_000_000.0), 0.1f);
		this.launchGabiMenu$lastNanoTime = now;

		boolean hovered = this.isActive() && this.isHoveredOrFocused();
		float target = hovered ? 1f : 0f;
		float step = 10f * deltaSeconds;
		if (this.launchGabiMenu$hoverProgress < target) {
			this.launchGabiMenu$hoverProgress = Math.min(target, this.launchGabiMenu$hoverProgress + step);
		} else if (this.launchGabiMenu$hoverProgress > target) {
			this.launchGabiMenu$hoverProgress = Math.max(target, this.launchGabiMenu$hoverProgress - step);
		}

		int x = this.getX();
		int y = this.getY();
		int right = this.getRight();
		int bottom = this.getBottom();

		if (this.launchGabiMenu$hoverProgress > 0.001f) {
			int alpha = (int) (this.launchGabiMenu$hoverProgress * 130f);
			int glow = ARGB.color(alpha, 199, 77, 255);
			guiGraphics.fill(x - 1, y - 1, right + 1, y, glow);
			guiGraphics.fill(x - 1, bottom, right + 1, bottom + 1, glow);
			guiGraphics.fill(x - 1, y, x, bottom, glow);
			guiGraphics.fill(right, y, right + 1, bottom, glow);
		}

		if (this.launchGabiMenu$pressStartNanos >= 0L) {
			float pressDuration = 0.15f;
			float elapsed = (float) ((now - this.launchGabiMenu$pressStartNanos) / 1_000_000_000.0);
			if (elapsed >= pressDuration) {
				this.launchGabiMenu$pressStartNanos = -1L;
			} else {
				int alpha = (int) ((1f - elapsed / pressDuration) * 90f);
				guiGraphics.fill(x, y, right, bottom, ARGB.color(alpha, 255, 255, 255));
			}
		}
	}

	@Inject(method = "mouseClicked", at = @At("RETURN"))
	private void launchGabiMenu$onMouseClicked(MouseButtonEvent event, boolean doubleClick, CallbackInfoReturnable<Boolean> cir) {
		if (cir.getReturnValueZ()) {
			this.launchGabiMenu$pressStartNanos = System.nanoTime();
		}
	}
}
