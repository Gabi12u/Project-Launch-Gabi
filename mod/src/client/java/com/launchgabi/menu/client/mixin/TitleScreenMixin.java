package com.launchgabi.menu.client.mixin;

import com.launchgabi.menu.client.TitleScreenLayout;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.resources.Identifier;
import net.minecraft.util.ARGB;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Draws the translucent panel behind the title screen's button cluster.
 * Injected right before the call to {@code super.render(...)} inside
 * {@link TitleScreen#render}, which is the one point between the panorama
 * and the buttons being drawn: early enough that the panel sits behind every
 * button, late enough that the panorama is already there to sit on top of.
 */
@Mixin(TitleScreen.class)
public class TitleScreenMixin {
	private static final Identifier PANEL_SPRITE = Identifier.fromNamespaceAndPath("launchgabi_menu", "panel/main_menu_panel");

	@Inject(
		method = "render",
		at = @At(
			value = "INVOKE",
			target = "Lnet/minecraft/client/gui/screens/Screen;render(Lnet/minecraft/client/gui/GuiGraphics;IIF)V"
		)
	)
	private void launchGabiMenu$beforeWidgets(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick, CallbackInfo info) {
		TitleScreen self = (TitleScreen) (Object) this;
		int[] bounds = TitleScreenLayout.panelBounds(self);
		if (bounds == null) {
			return;
		}

		float alpha = TitleScreenLayout.panelFadeAlpha(self);
		guiGraphics.blitSprite(
			RenderPipelines.GUI_TEXTURED, PANEL_SPRITE, bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1], ARGB.white(alpha)
		);
	}
}
